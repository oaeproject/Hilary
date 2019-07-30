/*
 * Copyright 2014 Apereo Foundation (AF) Licensed under the
 * Educational Community License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://opensource.org/licenses/ECL-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an "AS IS"
 * BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import querystring from 'querystring';
import url from 'url';
import gm from 'gm';
import _ from 'underscore';

import * as LocalStorage from 'oae-content/lib/backends/local';
import * as RestAPI from 'oae-rest';
import * as RestUtil from 'oae-rest/lib/util';
import * as SearchTestsUtil from 'oae-search/lib/test/util';
import * as TestsUtil from 'oae-tests';
import * as PrincipalsTestUtil from 'oae-principals/lib/test/util';
import * as PrincipalsUtil from 'oae-principals/lib/util';

import { PrincipalsConstants } from 'oae-principals/lib/constants';

describe('Profile pictures', () => {
  // Rest context that can be used every time we need to make a request as a global admin
  let globalAdminRestContext = null;
  // Rest context that can be used every time we need to make a request as a Cambridge tenant admin
  let camAdminRestContext = null;
  // Rest context that can be used every time we need to make an anonymous request to the Cambridge tenant
  let anonymousRestContext = null;
  // The directory where files will be stored during the tests
  let rootFilesDir = null;

  before(callback => {
    // Fill up the global admin rest context
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
    // Fill up tenant admin rest context
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    // Fill up anonymous rest context
    anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    // Get the root files directory
    rootFilesDir = LocalStorage.getRootDirectory();
    RestAPI.User.getMe(camAdminRestContext, (err, user) => {
      assert.ok(!err);
      return callback();
    });
  });

  /**
   * Create a user and return a RestContext for it
   *
   * @param  {Function}       callback        Standard callback function
   * @param  {RestContext}    callback.ctx    The RestContext for the created user
   * @api private
   */
  const _createUser = function(callback) {
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
      assert.ok(!err);
      const user = _.values(users)[0];
      const ctx = user.restContext;
      ctx.user = user.user;
      return callback(ctx);
    });
  };

  /**
   * Create 2 users
   *
   * @param  {Function}   callback            Standard callback function
   * @param  {Object}     callback.contexts   The RestContexts for the created users keyed by 'simon' and 'nicolaas'
   * @api private
   */
  const _createUsers = function(callback) {
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users) => {
      assert.ok(!err);
      const contexts = {};
      users = _.values(users);
      contexts.simon = users[0];
      contexts.nicolaas = users[1];
      return callback(contexts);
    });
  };

  /**
   * @return {Stream} A stream to jpg image
   * @api private
   */
  const _getPictureStream = function() {
    const file = path.join(__dirname, '/data/restroom.jpg');
    return fs.createReadStream(file);
  };

  /**
   * @return {Stream} A stream to text file
   * @api private
   */
  const _getTextStream = function() {
    const file = path.join(__dirname, '/data/speech.txt');
    return fs.createReadStream(file);
  };

  /**
   * Returns an object that can be used to crop out a rectangle
   * @api private
   */
  const _createSelectedArea = function(x, y, width) {
    return {
      x,
      y,
      width
    };
  };

  /**
   * Given a picture URL, parse the backend URI from the query string
   * @api private
   */
  const _getUriFromDownloadUrl = function(downloadUrl) {
    const DUMMY_BASE = 'http://localhost';
    return new URL(downloadUrl, DUMMY_BASE).searchParams.get('uri');
  };

  /**
   * Verifies the size of an image
   *
   * @param  {String}     uri         URI to the image we want to verify the size of
   * @param  {Number}     width       Expected width of the image
   * @param  {Number}     height      Expected height of the image
   * @param  {Function}   callback    Standard callback function
   * @api private
   */
  const _verifySize = function(uri, width, height, callback) {
    // Strip 'local:' from the uri.
    const uriPath = rootFilesDir + '/' + uri.substr(6);

    // #564 - Ensure the filename contains the extension.
    assert.strictEqual(path.extname(uriPath), '.jpg');

    gm(uriPath).size((err, size) => {
      assert.ok(!err);
      assert.strictEqual(size.width, width);
      assert.strictEqual(size.height, height);
      return callback();
    });
  };

  /**
   * Attempts to crop a picture, if it's expected to succeed the resulting file and the updated
   * principal object will be checked
   *
   * @param  {RestContext}        restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
   * @param  {User|Group}         principal           User or group object representing the principal for which we're trying to crop the profile picture
   * @param  {Object}             selectedArea        The topleft coordinates and size of the square that should be cropped out
   * @param  {Number}             selectedArea.x      The top left x coordinate
   * @param  {Number}             selectedArea.y      The top left y coordinate
   * @param  {Number}             selectedArea.width  The width of the square
   * @param  {Number}             expectedHttpCode    The expected response code for the cropping request
   * @param  {Function}           callback            Standard callback function
   * @api private
   */
  const _verifyCropping = function(restCtx, principal, selectedArea, expectedHttpCode, callback) {
    RestAPI.Crop.cropPicture(restCtx, principal.id, selectedArea, (err, data) => {
      if (expectedHttpCode === 200) {
        assert.ok(!err);
      } else {
        // It was expected that this request would fail
        assert.strictEqual(err.code, expectedHttpCode);
        return callback();
      }

      // When the request was OK, we verify if the cropping actually happened
      _verifySize(
        _getUriFromDownloadUrl(data.picture.small),
        PrincipalsConstants.picture.size.SMALL,
        PrincipalsConstants.picture.size.SMALL,
        () => {
          _verifySize(
            _getUriFromDownloadUrl(data.picture.medium),
            PrincipalsConstants.picture.size.MEDIUM,
            PrincipalsConstants.picture.size.MEDIUM,
            () => {
              // Make sure the returned profile object has the expected properties
              assert.strictEqual(data.id, principal.id);
              assert.strictEqual(data.displayName, principal.displayName);
              assert.strictEqual(data.description, principal.description);
              assert.strictEqual(data.profilePath, principal.profilePath);
              assert.strictEqual(data.resourceType, principal.resourceType);
              assert.strictEqual(data.tenant.displayName, principal.tenant.displayName);
              assert.strictEqual(data.visibility, principal.visibility);
              assert.ok(data.picture);

              if (PrincipalsUtil.isGroup(principal.id)) {
                assert.strictEqual(data.alias, principal.alias);
                assert.strictEqual(data.joinable, principal.joinable);
                assert.ok(!data.locale);
                assert.ok(!data.publicAlias);
                assert.strictEqual(data.isManager, true);
                assert.strictEqual(data.isMember, true);
                assert.strictEqual(data.canJoin, false);
              } else {
                assert.strictEqual(data.publicAlias, principal.publicAlias);
                assert.ok(data.locale);
                assert.ok(!data.alias);
              }

              return callback();
            }
          );
        }
      );
    });
  };

  /**
   * Test that verifies that a picture can be uploaded
   */
  it('verify uploading', callback => {
    _createUser(ctx => {
      // Verify uploading a picture for a user
      RestAPI.User.uploadPicture(ctx, ctx.user.id, _getPictureStream, null, err => {
        assert.ok(!err);

        // Verify it for a group
        TestsUtil.generateTestGroups(ctx, 1, function(...args) {
          const groupId = _.first(args).group.id;
          RestAPI.User.uploadPicture(ctx, groupId, _getPictureStream, null, err => {
            assert.ok(!err);
            return callback();
          });
        });
      });
    });
  });

  /**
   * Test that verifies basic required parameters
   */
  it('verify basic parameter requirements', callback => {
    _createUser(ctx => {
      RestAPI.User.uploadPicture(ctx, ctx.user.id, null, null, err => {
        assert.strictEqual(err.code, 400);
        callback();
      });
    });
  });

  /**
   * Test that verifies that the picture upload endpoint only accepts pictures
   */
  it('verify uploading bad mimetype', callback => {
    _createUser(ctx => {
      RestAPI.User.uploadPicture(ctx, ctx.user.id, _getTextStream, null, err => {
        assert.strictEqual(err.code, 400);
        callback();
      });
    });
  });

  /**
   * Test that verifies that pictures larger than 10 MB are rejected
   */
  it('verify a picture cannot be more than 10 MB', callback => {
    _createUser(ctx => {
      RestAPI.User.uploadPicture(
        ctx,
        ctx.user.id,
        TestsUtil.createFileReadableStream('pic.png', 10 * 1024 * 1024 + 1),
        null,
        err => {
          assert.strictEqual(err.code, 400);
          callback();
        }
      );
    });
  });

  /**
   * Test that verifies cropping
   */
  it('verify cropping', callback => {
    _createUser(ctx => {
      RestAPI.User.uploadPicture(ctx, ctx.user.id, _getPictureStream, null, err => {
        assert.ok(!err);
        const selectedArea = _createSelectedArea(10, 10, 200);
        _verifyCropping(ctx, ctx.user, selectedArea, 200, callback);
      });
    });
  });

  /**
   * Test that verifies that an appropriate response is sent when you haven't uploaded a picture yet
   */
  it("verify cropping fails if the user hasn't uploaded a picture yet", callback => {
    _createUser(ctx => {
      _verifyCropping(ctx, ctx.user, _createSelectedArea(10, 10, 200), 400, callback);
    });
  });

  /**
   * Test that verifies that you can crop and upload an image with 1 REST API call
   */
  it('verify uploading and cropping', callback => {
    _createUser(ctx => {
      const selectedArea = _createSelectedArea(10, 10, 200);
      RestAPI.User.uploadPicture(ctx, ctx.user.id, _getPictureStream, selectedArea, err => {
        assert.ok(!err);
        callback();
      });
    });
  });

  /**
   * Test that verifies that the area selection cannot be negative
   */
  it('verify cropping validation negative coordinates', callback => {
    _createUser(ctx => {
      RestAPI.User.uploadPicture(ctx, ctx.user.id, _getPictureStream, null, err => {
        assert.ok(!err);
        _verifyCropping(ctx, ctx.user, _createSelectedArea(-10, 10, 200), 400, () => {
          _verifyCropping(ctx, ctx.user, _createSelectedArea(10, -10, 200), 400, () => {
            _verifyCropping(ctx, ctx.user, _createSelectedArea(-10, -10, 200), 400, () => {
              _verifyCropping(ctx, ctx.user, _createSelectedArea(10, 10, -200), 400, callback);
            });
          });
        });
      });
    });
  });

  /**
   * Test that verifies that the area selection does type validation
   */
  it('verify cropping validation area only takes numbers', callback => {
    _createUser(ctx => {
      RestAPI.User.uploadPicture(ctx, ctx.user.id, _getPictureStream, null, err => {
        assert.ok(!err);
        _verifyCropping(ctx, ctx.user, _createSelectedArea('foo', 10, 200), 400, () => {
          _verifyCropping(ctx, ctx.user, _createSelectedArea(10, 'foo', 200), 400, () => {
            _verifyCropping(ctx, ctx.user, _createSelectedArea(10, 10, 'foo'), 400, () => {
              _verifyCropping(ctx, ctx.user, _createSelectedArea(10, 10, NaN), 400, callback);
            });
          });
        });
      });
    });
  });

  /**
   * Test that verifies that the cropped rectangle should be completely within the image boundaries
   */
  it('verify cropping cannot happen partially outside of the image', callback => {
    _createUser(ctx => {
      RestAPI.User.uploadPicture(ctx, ctx.user.id, _getPictureStream, null, err => {
        assert.ok(!err);
        _verifyCropping(ctx, ctx.user, _createSelectedArea(10, 10, 20000), 400, callback);
      });
    });
  });

  /**
   * Test that verifies that you cannot crop outside the image
   */
  it('verify cropping fails if x or y coord is outside of image', callback => {
    _createUser(ctx => {
      RestAPI.User.uploadPicture(ctx, ctx.user.id, _getPictureStream, null, err => {
        assert.ok(!err);
        _verifyCropping(ctx, ctx.user, _createSelectedArea(20000, 10, 100), 400, () => {
          _verifyCropping(ctx, ctx.user, _createSelectedArea(10, 200000, 100), 400, callback);
        });
      });
    });
  });

  /**
   * Test that verifies that you can download a user picture
   */
  it('verify downloading user picture', callback => {
    _createUsers(contexts => {
      const selectedArea = _createSelectedArea(10, 10, 200, 200);
      RestAPI.User.uploadPicture(
        contexts.simon.restContext,
        contexts.simon.user.id,
        _getPictureStream,
        selectedArea,
        err => {
          assert.ok(!err);

          // Download the different sizes
          RestAPI.User.downloadPicture(
            contexts.simon.restContext,
            contexts.simon.user.id,
            'small',
            (err, body, response) => {
              assert.ok(!err);
              assert.strictEqual(response.statusCode, 204);
              RestAPI.User.downloadPicture(
                contexts.simon.restContext,
                contexts.simon.user.id,
                'medium',
                (err, body, response) => {
                  assert.ok(!err);
                  assert.strictEqual(response.statusCode, 204);
                  RestAPI.User.downloadPicture(
                    contexts.simon.restContext,
                    contexts.simon.user.id,
                    'large',
                    (err, body, response) => {
                      assert.ok(!err);
                      assert.strictEqual(response.statusCode, 204);

                      // Now try downloading it with some invalid parameters
                      RestAPI.User.downloadPicture(
                        contexts.simon.restContext,
                        'invalid-user-id',
                        'small',
                        (err, body, response) => {
                          assert.strictEqual(err.code, 400);
                          RestAPI.User.downloadPicture(
                            contexts.simon.restContext,
                            contexts.simon.user.id,
                            null,
                            (err, body, response) => {
                              assert.strictEqual(err.code, 400);

                              // Nicolaas has no picture, this should result in a 404
                              RestAPI.User.downloadPicture(
                                contexts.simon.restContext,
                                contexts.nicolaas.user.id,
                                'small',
                                (err, body, response) => {
                                  assert.strictEqual(err.code, 404);
                                  callback();
                                }
                              );
                            }
                          );
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  });

  /**
   * Test that verifies that you can download a group picture
   */
  it('verify downloading group picture', callback => {
    _createUser(ctx => {
      TestsUtil.generateTestGroups(ctx, 2, (groupA, groupB) => {
        const selectedArea = _createSelectedArea(10, 10, 200, 200);

        RestAPI.Group.uploadPicture(ctx, groupA.group.id, _getPictureStream, selectedArea, err => {
          assert.ok(!err);

          // Download the different sizes
          RestAPI.Group.downloadPicture(ctx, groupA.group.id, 'small', (err, body, response) => {
            assert.ok(!err);
            assert.strictEqual(response.statusCode, 204);
            RestAPI.Group.downloadPicture(ctx, groupA.group.id, 'medium', (err, body, response) => {
              assert.ok(!err);
              assert.strictEqual(response.statusCode, 204);
              RestAPI.Group.downloadPicture(ctx, groupA.group.id, 'large', (err, body, response) => {
                assert.ok(!err);
                assert.strictEqual(response.statusCode, 204);

                // Now try downloading it with some invalid parameters
                RestAPI.Group.downloadPicture(ctx, 'invalid-group-id', 'small', (err, body, response) => {
                  assert.strictEqual(err.code, 400);
                  RestAPI.Group.downloadPicture(ctx, groupA.group.id, null, (err, body, response) => {
                    assert.strictEqual(err.code, 400);

                    // The other group has no picture, this should result in a 404
                    RestAPI.Group.downloadPicture(ctx, groupB.group.id, 'small', (err, body, response) => {
                      assert.strictEqual(err.code, 404);
                      callback();
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });

  /**
   * Test that verifies that you can upload/crop/download profile pictures for groups.
   */
  it('verify uploading, cropping and downloading of group profile pictures', callback => {
    _createUser(ctx => {
      TestsUtil.generateTestGroups(ctx, 1, group => {
        group = group.group;
        RestAPI.Group.uploadPicture(ctx, group.id, _getPictureStream, null, err => {
          assert.ok(!err);
          _verifyCropping(ctx, group, _createSelectedArea(-10, 10, 200), 400, () => {
            _verifyCropping(ctx, group, _createSelectedArea(10, -10, 200), 400, () => {
              _verifyCropping(ctx, group, _createSelectedArea(-10, -10, 200), 400, () => {
                _verifyCropping(ctx, group, _createSelectedArea(10, 10, 200), 200, () => {
                  // Download the different sizes.
                  RestAPI.Group.downloadPicture(ctx, group.id, 'small', (err, body, request) => {
                    assert.ok(!err);
                    assert.strictEqual(request.statusCode, 204);
                    RestAPI.Group.downloadPicture(ctx, group.id, 'medium', (err, body, request) => {
                      assert.ok(!err);
                      assert.strictEqual(request.statusCode, 204);
                      RestAPI.Group.downloadPicture(ctx, group.id, 'large', (err, body, request) => {
                        assert.ok(!err);
                        assert.strictEqual(request.statusCode, 204);
                        callback();
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });

  /**
   * Test that verifies that the endpoints don't expose profile pictures if the user has set his visibility to private/loggedin.
   */
  it('verify visibility of cropped profile pictures', callback => {
    _createUsers(contexts => {
      const selectedArea = _createSelectedArea(10, 10, 200, 200);
      RestAPI.User.uploadPicture(
        contexts.simon.restContext,
        contexts.simon.user.id,
        _getPictureStream,
        selectedArea,
        err => {
          assert.ok(!err);

          RestAPI.User.updateUser(
            contexts.simon.restContext,
            contexts.simon.user.id,
            { visibility: 'private' },
            err => {
              assert.ok(!err);

              RestAPI.User.getUser(contexts.nicolaas.restContext, contexts.simon.user.id, (err, user) => {
                assert.ok(!err);
                assert.strictEqual(user.picture.small, undefined);
                assert.strictEqual(user.picture.smallUri, undefined);
                assert.strictEqual(user.picture.medium, undefined);
                assert.strictEqual(user.picture.mediumUri, undefined);
                assert.strictEqual(user.picture.large, undefined);
                assert.strictEqual(user.picture.largeUri, undefined);

                RestAPI.User.getUser(anonymousRestContext, contexts.simon.user.id, (err, user) => {
                  assert.ok(!err);
                  assert.strictEqual(user.picture.small, undefined);
                  assert.strictEqual(user.picture.smallUri, undefined);
                  assert.strictEqual(user.picture.medium, undefined);
                  assert.strictEqual(user.picture.mediumUri, undefined);
                  assert.strictEqual(user.picture.large, undefined);
                  assert.strictEqual(user.picture.largeUri, undefined);

                  RestAPI.User.updateUser(
                    contexts.simon.restContext,
                    contexts.simon.user.id,
                    { visibility: 'loggedin' },
                    err => {
                      assert.ok(!err);

                      RestAPI.User.getUser(contexts.nicolaas.restContext, contexts.simon.user.id, (err, user) => {
                        assert.ok(!err);
                        assert.ok(user.picture.small);
                        assert.ok(!user.picture.smallUri);
                        assert.ok(user.picture.medium);
                        assert.ok(!user.picture.mediumUri);
                        assert.ok(user.picture.large);
                        assert.ok(!user.picture.largeUri);

                        // The user who owns the pictures can see everything
                        RestAPI.User.getUser(contexts.simon.restContext, contexts.simon.user.id, (err, user) => {
                          assert.ok(!err);
                          assert.ok(user.picture.small);
                          assert.ok(!user.picture.smallUri);
                          assert.ok(user.picture.medium);
                          assert.ok(!user.picture.mediumUri);
                          assert.ok(user.picture.large);
                          assert.ok(!user.picture.largeUri);
                          callback();
                        });
                      });
                    }
                  );
                });
              });
            }
          );
        }
      );
    });
  });

  /**
   * Test that verifies that you cannot set/crop a picture for someone else.
   */
  it('verify uploading or cropping a picture for another user is not allowed', callback => {
    _createUsers(contexts => {
      RestAPI.User.uploadPicture(
        contexts.simon.restContext,
        contexts.nicolaas.user.id,
        _getPictureStream,
        null,
        err => {
          assert.strictEqual(err.code, 401);
          _verifyCropping(
            contexts.simon.restContext,
            contexts.nicolaas.user,
            _createSelectedArea(10, 10, 200),
            401,
            callback
          );
        }
      );
    });
  });

  /**
   * Test that verifies that you cannot set a picture for a group you have no management rights on.
   */
  it('verify uploading or cropping a picture for a non-managed group is not allowed', callback => {
    _createUsers(contexts => {
      TestsUtil.generateTestGroups(contexts.simon.restContext, 1, group => {
        group = group.group;
        RestAPI.Group.uploadPicture(contexts.nicolaas.restContext, group.id, _getPictureStream, null, err => {
          assert.strictEqual(err.code, 401);
          _verifyCropping(contexts.nicolaas.restContext, group, _createSelectedArea(10, 10, 200), 401, () => {
            // Making Nico a member should still not allow him to change the picture.
            const members = {};
            members[contexts.nicolaas.user.id] = 'member';
            RestAPI.Group.setGroupMembers(contexts.simon.restContext, group.id, members, err => {
              assert.ok(!err);
              RestAPI.Group.uploadPicture(contexts.nicolaas.restContext, group.id, _getPictureStream, null, err => {
                assert.strictEqual(err.code, 401);
                _verifyCropping(contexts.nicolaas.restContext, group, _createSelectedArea(10, 10, 200), 401, () => {
                  // Making him a manager should.
                  members[contexts.nicolaas.user.id] = 'manager';
                  RestAPI.Group.setGroupMembers(contexts.simon.restContext, group.id, members, err => {
                    assert.ok(!err);
                    RestAPI.Group.uploadPicture(
                      contexts.nicolaas.restContext,
                      group.id,
                      _getPictureStream,
                      null,
                      err => {
                        assert.ok(!err);
                        _verifyCropping(
                          contexts.nicolaas.restContext,
                          group,
                          _createSelectedArea(10, 10, 200),
                          200,
                          callback
                        );
                      }
                    );
                  });
                });
              });
            });
          });
        });
      });
    });
  });

  /**
   * Test that verifies that the urls we generate for profile pictures are cacheable.
   */
  it('verify profile pictures are cacheable', callback => {
    _createUser(ctx => {
      const selectedArea = _createSelectedArea(10, 10, 200, 200);
      RestAPI.User.uploadPicture(ctx, ctx.user.id, _getPictureStream, selectedArea, err => {
        assert.ok(!err);

        // Get my data twice, the url's for the pictures shouldn't change as that would mean they aren't cacheable
        RestAPI.User.getUser(ctx, ctx.user.id, (err, firstRequestUser) => {
          assert.ok(!err);
          RestAPI.User.getUser(ctx, ctx.user.id, (err, secondRequestUser) => {
            assert.ok(!err);
            assert.strictEqual(firstRequestUser.smallPicture, secondRequestUser.smallPicture);
            assert.strictEqual(firstRequestUser.mediumPicture, secondRequestUser.mediumPicture);
            assert.strictEqual(firstRequestUser.largePicture, secondRequestUser.largePicture);
            return callback();
          });
        });
      });
    });
  });

  /**
   * Test that verifies that when you upload a new picture, the old profile pictures does NOT get removed.
   */
  it('verify that old pictures are not removed when uploading a new large picture', callback => {
    _createUser(ctx => {
      const selectedArea = _createSelectedArea(10, 10, 200, 200);
      RestAPI.User.uploadPicture(ctx, ctx.user.id, _getPictureStream, selectedArea, err => {
        assert.ok(!err);

        // Get the user metadata and thus the picture url.
        RestAPI.User.getUser(ctx, ctx.user.id, (err, firstRequestUser) => {
          assert.ok(!err);

          // Upload a new picture.
          RestAPI.User.uploadPicture(ctx, ctx.user.id, _getPictureStream, null, err => {
            assert.ok(!err);

            // Get the new user metadata.
            RestAPI.User.getUser(ctx, ctx.user.id, (err, secondRequestUser) => {
              assert.ok(!err);

              // Get the URIs and check that they are not removed on the filesystem
              const smallPicturePath =
                rootFilesDir + '/' + _getUriFromDownloadUrl(firstRequestUser.picture.small).split(':')[1];
              const mediumPicturePath =
                rootFilesDir + '/' + _getUriFromDownloadUrl(firstRequestUser.picture.medium).split(':')[1];
              assert.strictEqual(
                fs.existsSync(smallPicturePath),
                true,
                'The small picture should still exist when uploading a large image'
              );
              assert.strictEqual(
                fs.existsSync(mediumPicturePath),
                true,
                'The medium picture should still exist when uploading a large image'
              );
              return callback();
            });
          });
        });
      });
    });
  });

  /**
   * Test that verifies the principals in upload and crop responses contain the signed picture URLs and not
   * the back-end URIs
   */
  it('verify that uploading and cropping responds with the expected principal model and no back-end picture URIs', callback => {
    // Create a user to which we can upload a profile picture
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, mrvisser) => {
      assert.ok(!err);

      // Upload the profile picture and crop it for the user
      PrincipalsTestUtil.uploadAndCropPicture(
        mrvisser.restContext,
        mrvisser.user.id,
        _getPictureStream,
        { x: 10, y: 10, width: 200 },
        (uploadPrincipal, cropPrincipal) => {
          // Ensure the user model of the "upload large picture" response
          assert.strictEqual(uploadPrincipal.tenant.alias, mrvisser.user.tenant.alias);
          assert.strictEqual(uploadPrincipal.tenant.displayName, mrvisser.user.tenant.displayName);
          assert.strictEqual(uploadPrincipal.id, mrvisser.user.id);
          assert.strictEqual(uploadPrincipal.displayName, mrvisser.user.displayName);
          assert.strictEqual(uploadPrincipal.visibility, mrvisser.user.visibility);
          assert.strictEqual(uploadPrincipal.email, mrvisser.user.email);
          assert.strictEqual(uploadPrincipal.locale, mrvisser.user.locale);
          assert.strictEqual(uploadPrincipal.timezone, mrvisser.user.timezone);
          assert.strictEqual(uploadPrincipal.publicAlias, mrvisser.user.publicAlias);
          assert.strictEqual(uploadPrincipal.profilePath, mrvisser.user.profilePath);
          assert.strictEqual(uploadPrincipal.resourceType, mrvisser.user.resourceType);
          assert.strictEqual(uploadPrincipal.acceptedTC, mrvisser.user.acceptedTC);
          assert.ok(uploadPrincipal.lastModified);
          assert.ok(!uploadPrincipal.picture.largeUri);
          assert.ok(uploadPrincipal.picture.large);
          assert.ok(!uploadPrincipal.picture.mediumUri);
          assert.ok(!uploadPrincipal.picture.medium);
          assert.ok(!uploadPrincipal.picture.smallUri);
          assert.ok(!uploadPrincipal.picture.small);

          // Ensure the user model of the "crop picture" response
          assert.strictEqual(cropPrincipal.tenant.alias, mrvisser.user.tenant.alias);
          assert.strictEqual(cropPrincipal.tenant.displayName, mrvisser.user.tenant.displayName);
          assert.strictEqual(cropPrincipal.id, mrvisser.user.id);
          assert.strictEqual(cropPrincipal.displayName, mrvisser.user.displayName);
          assert.strictEqual(cropPrincipal.visibility, mrvisser.user.visibility);
          assert.strictEqual(cropPrincipal.email, mrvisser.user.email);
          assert.strictEqual(cropPrincipal.locale, mrvisser.user.locale);
          assert.strictEqual(cropPrincipal.timezone, mrvisser.user.timezone);
          assert.strictEqual(cropPrincipal.publicAlias, mrvisser.user.publicAlias);
          assert.strictEqual(cropPrincipal.profilePath, mrvisser.user.profilePath);
          assert.strictEqual(cropPrincipal.resourceType, mrvisser.user.resourceType);
          assert.strictEqual(cropPrincipal.acceptedTC, mrvisser.user.acceptedTC);
          assert.ok(cropPrincipal.lastModified);
          assert.ok(!cropPrincipal.picture.largeUri);
          assert.ok(cropPrincipal.picture.large);
          assert.ok(!cropPrincipal.picture.mediumUri);
          assert.ok(cropPrincipal.picture.medium);
          assert.ok(!cropPrincipal.picture.smallUri);
          assert.ok(cropPrincipal.picture.small);

          // Create a group to which we can upload a profile picture
          TestsUtil.generateTestGroups(mrvisser.restContext, 1, group => {
            group = group.group;

            // Upload the profile picture and crop it for the group
            PrincipalsTestUtil.uploadAndCropPicture(
              mrvisser.restContext,
              group.id,
              _getPictureStream,
              { x: 10, y: 10, width: 200 },
              (uploadPrincipal, cropPrincipal) => {
                // Ensure the group model of the "upload large picture" response
                assert.strictEqual(uploadPrincipal.tenant.alias, group.tenant.alias);
                assert.strictEqual(uploadPrincipal.tenant.displayName, group.tenant.displayName);
                assert.strictEqual(uploadPrincipal.id, group.id);
                assert.strictEqual(uploadPrincipal.displayName, group.displayName);
                assert.strictEqual(uploadPrincipal.visibility, group.visibility);
                assert.strictEqual(uploadPrincipal.joinable, group.joinable);
                assert.strictEqual(uploadPrincipal.description, group.description);
                assert.strictEqual(uploadPrincipal.profilePath, group.profilePath);
                assert.strictEqual(uploadPrincipal.resourceType, group.resourceType);
                assert.ok(uploadPrincipal.lastModified);
                assert.ok(!uploadPrincipal.picture.largeUri);
                assert.ok(uploadPrincipal.picture.large);
                assert.ok(!uploadPrincipal.picture.mediumUri);
                assert.ok(!uploadPrincipal.picture.medium);
                assert.ok(!uploadPrincipal.picture.smallUri);
                assert.ok(!uploadPrincipal.picture.small);

                // Ensure the group model of the "crop picture" response
                assert.strictEqual(cropPrincipal.tenant.alias, group.tenant.alias);
                assert.strictEqual(cropPrincipal.tenant.displayName, group.tenant.displayName);
                assert.strictEqual(cropPrincipal.id, group.id);
                assert.strictEqual(cropPrincipal.displayName, group.displayName);
                assert.strictEqual(cropPrincipal.visibility, group.visibility);
                assert.strictEqual(cropPrincipal.joinable, group.joinable);
                assert.strictEqual(cropPrincipal.description, group.description);
                assert.strictEqual(cropPrincipal.profilePath, group.profilePath);
                assert.strictEqual(cropPrincipal.resourceType, group.resourceType);
                assert.ok(cropPrincipal.lastModified);
                assert.strictEqual(cropPrincipal.isMember, true);
                assert.strictEqual(cropPrincipal.isManager, true);
                assert.strictEqual(cropPrincipal.canJoin, false);
                assert.ok(!cropPrincipal.picture.largeUri);
                assert.ok(cropPrincipal.picture.large);
                assert.ok(!cropPrincipal.picture.mediumUri);
                assert.ok(cropPrincipal.picture.medium);
                assert.ok(!cropPrincipal.picture.smallUri);
                assert.ok(cropPrincipal.picture.small);

                return callback();
              }
            );
          });
        }
      );
    });
  });

  /**
   * This test searches through all the members of a group and checks if the current user can see the profile pictures of them.
   * It assumes that the group has 3 members, each with a different user visibility setting
   *
   * @param  {RestContext}    restContext         The context to search with
   * @param  {String}         groupId             The ID of the group
   * @param  {Boolean}        canPublic           Whether or not the user in the passed in `restContext` should be able to see the profile picture of the public user
   * @param  {Boolean}        canLoggedIn         Whether or not the user in the passed in `restContext` should be able to see the profile picture of the loggedin user
   * @param  {Boolean}        canPrivate          Whether or not the user in the passed in `restContext` should be able to see the profile picture of the private user
   * @param  {String}         publicUserId        The ID of the user who has a visibility set to public
   * @param  {String}         loggedinUserId      The ID of the user who has a visibility set to public
   * @param  {String}         privateUserId       The ID of the user who has a visibility set to private
   * @param  {Function}       callback            Standard callback function
   * @api private
   */
  const _verifySearchThumbnails = function(
    restContext,
    groupId,
    canPublic,
    canLoggedIn,
    canPrivate,
    publicUserId,
    loggedinUserId,
    privateUserId,
    callback
  ) {
    SearchTestsUtil.searchAll(restContext, 'members-library', [groupId], null, (err, results) => {
      assert.ok(!err);
      assert.strictEqual(results.total, 3);
      const users = {};
      for (let i = 0; i < results.results.length; i++) {
        users[results.results[i].id] = results.results[i];
      }

      assert.strictEqual(Object.prototype.hasOwnProperty.call(users[publicUserId], 'thumbnailUrl'), canPublic);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(users[loggedinUserId], 'thumbnailUrl'), canLoggedIn);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(users[privateUserId], 'thumbnailUrl'), canPrivate);
      callback();
    });
  };

  /**
   * Test that verifies that the thumbnail property in search results respects the user visibility
   */
  it('verify the user thumbnail visibility in member search results', callback => {
    // Setup the user/group structure.
    TestsUtil.generateTestUsers(camAdminRestContext, 4, (err, users) => {
      assert.ok(!err);

      const publicUser = _.values(users)[0];
      const loggedInUser = _.values(users)[1];
      const privateUser = _.values(users)[2];
      const nonMemberUser = _.values(users)[3];

      RestAPI.User.updateUser(loggedInUser.restContext, loggedInUser.user.id, { visibility: 'loggedin' }, err => {
        assert.ok(!err);

        RestAPI.User.updateUser(privateUser.restContext, privateUser.user.id, { visibility: 'private' }, err => {
          assert.ok(!err);

          // Each user has a profile picture
          const selectedArea = _createSelectedArea(10, 10, 200, 200);
          RestAPI.User.uploadPicture(
            publicUser.restContext,
            publicUser.user.id,
            _getPictureStream,
            selectedArea,
            err => {
              assert.ok(!err);

              RestAPI.User.uploadPicture(
                loggedInUser.restContext,
                loggedInUser.user.id,
                _getPictureStream,
                selectedArea,
                err => {
                  assert.ok(!err);

                  RestAPI.User.uploadPicture(
                    privateUser.restContext,
                    privateUser.user.id,
                    _getPictureStream,
                    selectedArea,
                    err => {
                      assert.ok(!err);

                      // Create a group with the two other members
                      const groupName = TestsUtil.generateTestUserId('someGroupName');
                      RestAPI.Group.createGroup(
                        privateUser.restContext,
                        groupName,
                        groupName,
                        'public',
                        'no',
                        [],
                        [loggedInUser.user.id, publicUser.user.id],
                        (err, group) => {
                          assert.ok(!err);

                          // Perform one search where we wait for the search index to refresh so all subsequent search requests don't have to wait
                          SearchTestsUtil.whenIndexingComplete(() => {
                            // The public member can only see his own thumbnail and the loggedin user
                            _verifySearchThumbnails(
                              publicUser.restContext,
                              group.id,
                              true,
                              true,
                              false,
                              publicUser.user.id,
                              loggedInUser.user.id,
                              privateUser.user.id,
                              () => {
                                // The 'logged in' user can see his own thumbnail and the public one
                                _verifySearchThumbnails(
                                  loggedInUser.restContext,
                                  group.id,
                                  true,
                                  true,
                                  false,
                                  publicUser.user.id,
                                  loggedInUser.user.id,
                                  privateUser.user.id,
                                  () => {
                                    // The private user can see everyone's thumbnail
                                    return _verifySearchThumbnails(
                                      privateUser.restContext,
                                      group.id,
                                      true,
                                      true,
                                      true,
                                      publicUser.user.id,
                                      loggedInUser.user.id,
                                      privateUser.user.id,
                                      callback
                                    );
                                  }
                                );
                              }
                            );
                          });
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        });
      });
    });
  });

  /**
   * Test that verifies that the thumbnail property in search results respects the group visibility
   */
  it('verify the thumbnail is present in group search results', callback => {
    // Setup the user/group structure
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
      assert.ok(!err);

      const simon = _.values(users)[0];

      // Create some groups
      TestsUtil.generateTestGroups(simon.restContext, 4, (oaeTeam, backendTeam, uiTeam, qaTeam) => {
        // Upload pictures for the sub teams
        const selectedArea = _createSelectedArea(10, 10, 200, 200);
        RestAPI.User.uploadPicture(simon.restContext, backendTeam.group.id, _getPictureStream, selectedArea, err => {
          assert.ok(!err);

          RestAPI.User.uploadPicture(simon.restContext, uiTeam.group.id, _getPictureStream, selectedArea, err => {
            assert.ok(!err);

            RestAPI.User.uploadPicture(simon.restContext, qaTeam.group.id, _getPictureStream, selectedArea, err => {
              assert.ok(!err);

              // Make the uiTeam loggedin.
              RestAPI.Group.updateGroup(simon.restContext, uiTeam.group.id, { visibility: 'loggedin' }, err => {
                assert.ok(!err);

                // Make the qa team private.
                RestAPI.Group.updateGroup(simon.restContext, qaTeam.group.id, { visibility: 'private' }, err => {
                  assert.ok(!err);

                  // Make the backend, ui and qa teams member of oae team.
                  const changes = {};
                  changes[backendTeam.group.id] = 'member';
                  changes[uiTeam.group.id] = 'member';
                  changes[qaTeam.group.id] = 'member';
                  RestAPI.Group.setGroupMembers(simon.restContext, oaeTeam.group.id, changes, err => {
                    assert.ok(!err);

                    // Search through the memberlist of oaeTeam and filter the results so we only get the backend team group back.
                    SearchTestsUtil.searchAll(
                      simon.restContext,
                      'members-library',
                      [oaeTeam.group.id],
                      { q: '' },
                      (err, results) => {
                        assert.ok(!err);
                        assert.strictEqual(results.total, 4);

                        // We only need the groups
                        results.results = _.filter(results.results, result => {
                          return result.resourceType !== 'user';
                        });

                        // All the groups should expose their thumbnail regardless of their visibility setting.
                        assert.ok(results.results[0].thumbnailUrl);
                        assert.ok(results.results[1].thumbnailUrl);
                        assert.ok(results.results[2].thumbnailUrl);

                        // Try downloading it by just using the returned url.
                        RestUtil.performRestRequest(
                          simon.restContext,
                          results.results[0].thumbnailUrl,
                          'GET',
                          null,
                          (err, body, response) => {
                            assert.ok(!err);
                            // Downloading happens via nginx, so we can't verify the response body.
                            // We can verify if the status code is a 204 and if the appropriate headers are present.
                            assert.strictEqual(response.statusCode, 204);
                            assert.ok(response.headers['x-accel-redirect']);
                            assert.ok(response.headers['content-disposition']);
                            callback();
                          }
                        );
                      }
                    );
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});
