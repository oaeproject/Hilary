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
import Path from 'path';
import sharp from 'sharp';

import { gt, toUpper, __ } from 'ramda';

import * as ImageUtil from 'oae-util/lib/image';

const greaterThanZero = gt(__, 0);

/**
 * Most of the tests in this suite don't actually crop or resize anything.
 * Those bits of code get tested via the oae-principals/tests/test-cropping suite.
 */
describe('Image', () => {
  const generateArea = function(x, y, width, height) {
    return {
      x,
      y,
      width,
      height
    };
  };

  const generateSize = function(width, height) {
    return {
      width,
      height
    };
  };

  describe('#cropImage()', () => {
    /**
     * Test that verifies that the parameters get validated
     */
    it('verify parameter validation', callback => {
      ImageUtil.cropImage(undefined, generateArea(10, 10, 200, 200), err => {
        assert.strictEqual(err.code, 400);
        ImageUtil.cropImage('some/path', generateArea(undefined, 10, 200, 200), err => {
          assert.strictEqual(err.code, 400);
          ImageUtil.cropImage('some/path', generateArea(10, undefined, 200), err => {
            assert.strictEqual(err.code, 400);
            ImageUtil.cropImage('some/path', generateArea(10, 10, undefined, 200), err => {
              assert.strictEqual(err.code, 400);
              ImageUtil.cropImage('some/path', generateArea(10, 10, 200, undefined), err => {
                assert.strictEqual(err.code, 400);

                // Verify you can't crop outside the image
                const path = Path.resolve(Path.join(__dirname, '/data/right.jpg'));
                ImageUtil.cropImage(path, generateArea(10000, 10000, 10, 10), (err, file) => {
                  assert.strictEqual(err.code, 500);

                  // Sanity check
                  ImageUtil.cropImage(path, generateArea(10, 10, 10, 10), (err, file) => {
                    assert.ok(!err, JSON.stringify(err, null, 4));
                    assert.ok(file);
                    assert.ok(file.path);
                    assert.ok(fs.existsSync(file.path));
                    assert.ok(file.name);
                    assert.ok(greaterThanZero(file.size));
                    sharp(file.path).metadata((err, metainfo) => {
                      assert.ok(!err);
                      assert.strictEqual(metainfo.width, 10);
                      assert.strictEqual(metainfo.height, 10);

                      return callback();
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
     * Ensure that errors are being handled correctly.
     */
    it('verify error handling', callback => {
      // Calling cropImage, with a non-existing path should fail.
      ImageUtil.cropImage('some/path', generateArea(10, 10, 200, 200), err => {
        assert.strictEqual(err.code, 500);
        callback();
      });
    });
  });

  describe('#resizeImage()', () => {
    /**
     * Simple validation checks.
     */
    it('verify parameter validation', callback => {
      ImageUtil.resizeImage(undefined, generateSize(200, 200), err => {
        assert.strictEqual(err.code, 400);
        ImageUtil.resizeImage('some/path', generateSize(-10, 200), err => {
          assert.strictEqual(err.code, 400);
          ImageUtil.resizeImage('some/path', generateSize(10, -200), err => {
            assert.strictEqual(err.code, 400);
            callback();
          });
        });
      });
    });

    /**
     * Ensure that errors are being handled correctly.
     */
    it('verify error handling', callback => {
      ImageUtil.resizeImage('some/path', generateSize(200, 200), err => {
        assert.strictEqual(err.code, 500);
        callback();
      });
    });

    /**
     * Test that will verify the `autoOrient` function.
     */
    it('verify EXIF orientation is obeyed', callback => {
      const path = Path.resolve(Path.join(__dirname, '/data/right.jpg'));
      ImageUtil.autoOrient(path, null, (err, file) => {
        assert.ok(!err);
        assert.ok(file);
        assert.ok(file.path);
        assert.ok(file.name);
        assert.ok(greaterThanZero(file.size));

        // The image should've been rotated and it's orientation should be fixed.
        sharp(file.path).metadata((err, metainfo) => {
          assert.ok(!err);
          assert.strictEqual(metainfo.width, 480);
          assert.strictEqual(metainfo.height, 640);

          // The EXIF orientation should be removed.
          assert.strictEqual(metainfo.orientation, undefined);
          callback();
        });
      });
    });
  });

  describe('#cropAndResize()', callback => {
    /**
     * Simple validation checks.
     */
    it('verify parameter validation', callback => {
      ImageUtil.cropAndResize(undefined, generateArea(0, 0, 200, 200), [generateSize(100, 100)], (err, files) => {
        assert.strictEqual(err.code, 400);
        assert.ok(!files);
        ImageUtil.cropAndResize('some/path', null, [generateSize(100, 100)], (err, files) => {
          assert.strictEqual(err.code, 400);
          assert.ok(!files);
          ImageUtil.cropAndResize(
            'some/path',
            generateArea(-10, 0, 200, 200),
            [generateSize(100, 100)],
            (err, files) => {
              assert.strictEqual(err.code, 400);
              assert.ok(!files);
              ImageUtil.cropAndResize(
                'some/path',
                generateArea(0, -10, 200, 200),
                [generateSize(100, 100)],
                (err, files) => {
                  assert.strictEqual(err.code, 400);
                  assert.ok(!files);
                  ImageUtil.cropAndResize(
                    'some/path',
                    generateArea(0, 0, -10, 200),
                    [generateSize(100, 100)],
                    (err, files) => {
                      assert.strictEqual(err.code, 400);
                      assert.ok(!files);
                      ImageUtil.cropAndResize(
                        'some/path',
                        generateArea(-10, 0, 200, 200),
                        [generateSize(100, 100)],
                        (err, files) => {
                          assert.strictEqual(err.code, 400);
                          assert.ok(!files);
                          ImageUtil.cropAndResize('some/path', generateArea(10, 0, 200, 200), null, (err, files) => {
                            assert.strictEqual(err.code, 400);
                            assert.ok(!files);
                            ImageUtil.cropAndResize('some/path', generateArea(10, 0, 200, 200), [], (err, files) => {
                              assert.strictEqual(err.code, 400);
                              assert.ok(!files);
                              ImageUtil.cropAndResize(
                                'some/path',
                                generateArea(10, 0, 200, 200),
                                [generateSize(-10, 10)],
                                (err, files) => {
                                  assert.strictEqual(err.code, 400);
                                  assert.ok(!files);
                                  ImageUtil.cropAndResize(
                                    'some/path',
                                    generateArea(10, 0, 200, 200),
                                    [generateSize(10, -10)],
                                    (err, files) => {
                                      assert.strictEqual(err.code, 400);
                                      assert.ok(!files);
                                      // Sanity check.
                                      const path = Path.resolve(Path.join(__dirname, '/data/right.jpg'));
                                      ImageUtil.cropAndResize(
                                        path,
                                        generateArea(10, 0, 10, 10),
                                        [generateSize(20, 20)],
                                        (err, files) => {
                                          assert.ok(!err);
                                          assert.ok(files);
                                          assert.ok(files['20x20']);
                                          assert.ok(files['20x20'].path);
                                          assert.ok(fs.existsSync(files['20x20'].path));
                                          assert.ok(files['20x20'].name);
                                          assert.ok(greaterThanZero(files['20x20'].size));
                                          sharp(files['20x20'].path).metadata((err, metainfo) => {
                                            assert.ok(!err);
                                            assert.strictEqual(metainfo.width, 20);
                                            assert.strictEqual(metainfo.height, 20);
                                            callback();
                                          });
                                        }
                                      );
                                    }
                                  );
                                }
                              );
                            });
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

  describe('#convertToJPG()', () => {
    /**
     * Test that verifies the parameters are validated
     */
    it('verify parameter validation', callback => {
      ImageUtil.convertToJPG(null, (err, file) => {
        assert.strictEqual(err.code, 400);
        assert.ok(!file);
        ImageUtil.convertToJPG('', (err, file) => {
          assert.strictEqual(err.code, 400);
          assert.ok(!file);

          // Non existing files should result in a 500
          ImageUtil.convertToJPG('non-existing', (err, file) => {
            assert.strictEqual(err.code, 500);
            assert.ok(!file);

            return callback();
          });
        });
      });
    });

    /**
     * Test that verifies that images get properly converted to JPG
     */
    it('verify images get properly converted to JPG', callback => {
      const path = Path.resolve(Path.join(__dirname, '/../../oae-preview-processor/tests/data/image.gif'));
      ImageUtil.convertToJPG(path, (err, file) => {
        assert.ok(!err);
        assert.ok(file);

        // Check it has really been converted to a JPG
        sharp(file.path).metadata((err, data) => {
          assert.ok(!err);
          assert.strictEqual(toUpper(data.format), 'JPEG');

          // Clean up the file
          fs.unlink(file.path, err => {
            return callback();
          });
        });
      });
    });
  });
});
