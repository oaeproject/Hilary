/*!
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

import _ from 'underscore';

import * as AuthzUtil from 'oae-authz/lib/util';
import { Validator as validator } from 'oae-util/lib/validator';
const { unless, isLoggedInUser, isUserId, isNotEmpty } = validator;

import * as OAuthDAO from './internal/dao';

/// //////////
// Clients //
/// //////////

/**
 * Get all OAuth clients for a user
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     userId              The id of the user for which to get the available OAuth clients
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Client}     callback.clients    The registerd OAuth clients for the user
 */
const getClients = function (ctx, userId, callback) {
  try {
    unless(isLoggedInUser, {
      code: 401,
      msg: 'Anonymous users do not have clients'
    })(ctx);

    unless(isUserId, {
      code: 400,
      msg: 'An invalid userId was passed in'
    })(userId);
  } catch (error) {
    return callback(error);
  }

  // Tenant admins are the only ones who can request another user their clients, provided that they're on the same tenant
  const userTenantAlias = AuthzUtil.getResourceFromId(userId).tenantAlias;
  if (ctx.user().id !== userId && !ctx.user().isAdmin(userTenantAlias)) {
    return callback({
      code: 401,
      msg: 'Only administrators can request registered clients of another user'
    });
  }

  OAuthDAO.Clients.getClientsByUser(userId, callback);
};

/**
 * Create an OAuth client
 *
 * Currently, global and/or tenant administrators are the only ones who can create OAuth clients.
 * They can create a client *for another* user if they choose to do so. The access associated to
 * that client will be the full access of the user for which you've created the client.
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     userId              The id of the user for which to create an OAuth client
 * @param  {String}     displayName         The name of the OAuth client
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Client}     callback.client     The created client
 */
const createClient = function (ctx, userId, displayName, callback) {
  try {
    unless(isLoggedInUser, {
      code: 401,
      msg: 'Anonymous users cannot create a client'
    })(ctx);

    unless(isUserId, {
      code: 400,
      msg: 'A client must be bound to a user'
    })(userId);

    unless(isNotEmpty, {
      code: 400,
      msg: 'Missing client displayName'
    })(displayName);
  } catch (error) {
    return callback(error);
  }

  // Tenant admins are the only ones who can create a client for a user, provided that they're on the same tenant
  const userTenantAlias = AuthzUtil.getResourceFromId(userId).tenantAlias;
  if (!ctx.user().isAdmin(userTenantAlias)) {
    return callback({ code: 401, msg: 'Only administrators can create OAuth clients' });
  }

  // Persist the client
  const id = generateToken(32);
  const secret = generateToken(32);
  OAuthDAO.Clients.createClient(id, displayName, secret, userId, callback);
};

/**
 * Update an OAuth client
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     clientId            The id of the OAuth client to update
 * @param  {String}     displayName         The updated name for the OAuth client
 * @param  {String}     secret              The updated secret for the OAuth client
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Client}     callback.client     The updated OAuth client
 */
const updateClient = function (ctx, clientId, displayName, secret, callback) {
  try {
    unless(isLoggedInUser, {
      code: 401,
      msg: 'Anonymous users cannot create a client'
    })(ctx);

    unless(isNotEmpty, {
      code: 400,
      msg: 'Missing client id'
    })(clientId);
  } catch (error) {
    return callback(error);
  }

  if (!displayName && !secret) {
    return callback({ code: 400, msg: 'A displayName and/or secret has to be provided' });
  }

  // Sanity check that the client is owned by the current user, or that he is a tenant administrator
  OAuthDAO.Clients.getClientById(clientId, (error, client) => {
    if (error) {
      return callback(error);
    }

    if (!client) {
      return callback({ code: 404, msg: 'No client with that id was found' });
    }

    const userTenantAlias = AuthzUtil.getResourceFromId(client.userId).tenantAlias;
    if (client.userId !== ctx.user().id && !ctx.user().isAdmin(userTenantAlias)) {
      return callback({ code: 401, msg: 'You cannot update a client that you do not own' });
    }

    displayName = displayName || client.displayName;
    secret = secret || client.secret;
    OAuthDAO.Clients.updateClient(clientId, displayName, secret, (error_) => {
      if (error_) {
        return callback(error_);
      }

      client.displayName = displayName;
      client.secret = secret;
      return callback(null, client);
    });
  });
};

/**
 * Delete an OAuth client
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     clientId        The id of the OAuth client to delete
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const deleteClient = function (ctx, clientId, callback) {
  try {
    unless(isLoggedInUser, {
      code: 401,
      msg: 'Anonymous users cannot delete a client'
    })(ctx);

    unless(isNotEmpty, {
      code: 400,
      msg: 'Missing client id'
    })(clientId);
  } catch (error) {
    return callback(error);
  }

  // Sanity check that the client is owned by the current user, or that he is a tenant administrator
  OAuthDAO.Clients.getClientById(clientId, (error, client) => {
    if (error) {
      return callback(error);
    }

    if (!client) {
      return callback({ code: 404, msg: 'No client with that id was found' });
    }

    const userTenantAlias = AuthzUtil.getResourceFromId(client.userId).tenantAlias;
    if (client.userId !== ctx.user().id && !ctx.user().isAdmin(userTenantAlias)) {
      return callback({ code: 401, msg: 'You cannot delete a client that you do not own' });
    }

    OAuthDAO.Clients.deleteClient(clientId, client.userId, callback);
  });
};

/// ////////////
// Utilities //
/// ////////////

/**
 * Generates a random string of a given size
 *
 * @param  {Number}   length    The length of the desired random string
 * @return {String}             A randomly generated string of a given length
 */
const generateToken = function (length) {
  let randomString = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < length; i++) {
    randomString += chars[_.random(0, chars.length - 1)];
  }

  return randomString;
};

const Clients = {
  getClients,
  createClient,
  updateClient,
  deleteClient
};
export { Clients, generateToken };
