/*!
 * Copyright 2015 Apereo Foundation (AF) Licensed under the
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

import { format, inherits } from 'node:util';
import _ from 'underscore';
import { Graph } from 'data-structures';

/**
 * AuthzGraph inherits from the data-structures Graph and provides some additional data and function
 * sugar to perform common grahing operations. Particularly, making traversal possible.
 */
const AuthzGraph = function () {
  Graph.call(this);
};

inherits(AuthzGraph, Graph);

/**
 * Determine if the graph is empty
 *
 * @return {Boolean}    Whether or not the graph has any nodes
 */
AuthzGraph.prototype.isEmpty = function () {
  return this.nodeSize === 0;
};

/**
 * Convenience function to collect all the nodes in the graph into an array
 *
 * @return {Object[]}  All nodes in the graph
 */
AuthzGraph.prototype.getNodes = function () {
  const nodes = [];
  this.forEachNode((node) => {
    nodes.push(node);
  });
  return nodes;
};

/**
 * Convenience function to collect all the edges in the graph into an array
 *
 * @return {Object[]}  All edges in the graph
 */
AuthzGraph.prototype.getEdges = function () {
  const edges = [];
  this.forEachEdge((edge) => {
    edges.push(edge);
  });
  return edges;
};

/**
 * Override the base Graph addNode function to include the `id` of the node. This will make it
 * easier to walk the graph
 *
 * @param  {String}     nodeId      The id of the node
 * @param  {Object}     [metadata]  Additional metadata to apply to the node. This is only applied if the node is new
 * @return {Object}                 The node object that was created. `null` if a node with the given id already existed
 */
AuthzGraph.prototype.addNode = function (nodeId, metadata) {
  const node = Graph.prototype.addNode.call(this, nodeId);
  if (node) {
    if (_.isObject(metadata)) {
      _.extend(node, metadata);
    }

    node.id = nodeId;
  }

  return node;
};

/**
 * Override the base Graph addEdge function to include the `from` and `to` nodes on the edge. This
 * will make it easier to walk the graph
 *
 * @param  {String}     fromId      The id of the source node of the edge
 * @param  {String}     toId        The id of the destination node of the edge
 * @param  {Object}     [metadata]  Additional metadata to apply to the edge. This is only applied if the edge is new
 * @return {Object}                 The edge object if an edge was created. `null` if this edge already existed
 */
AuthzGraph.prototype.addEdge = function (fromId, toId, metadata) {
  const edge = Graph.prototype.addEdge.call(this, fromId, toId);
  if (edge) {
    if (_.isObject(metadata)) {
      _.extend(edge, metadata);
    }

    edge.from = this.getNode(fromId);
    edge.to = this.getNode(toId);
  }

  return edge;
};

/**
 * Get a nice string representation of the graph
 */
AuthzGraph.prototype.toString = function () {
  const nodeStrs = _.pluck(this.getNodes(), 'id');
  const edgeStrs = _.map(this.getEdges(), (edge) => format('%s -> %s', edge.from.id, edge.to.id));

  return JSON.stringify({ nodes: nodeStrs, edges: edgeStrs }, null, 2);
};

/**
 * Iterate over the nodes in the graph by their inbound edges, starting from the provided `nodeId`
 * and doing a depth-first traversal
 *
 * @param  {String}     nodeId  The id of the node to start with. The node identified by this id will also be the first node in the resulting array
 * @return {Node[]}             An array of nodes that were traversed
 */
AuthzGraph.prototype.traverseIn = function (nodeId) {
  return this._traverse(nodeId, this.getInEdgesOf, 'from');
};

/**
 * Iterate over the nodes in the graph by their outbound edges, starting from the provided `nodeId`
 * and doing a depth-first traversal
 *
 * @param  {String}     nodeId  The id of the node to start with. The node identified by this id will also be the first node in the resulting array
 * @return {Node[]}             An array of nodes that were traversed
 */
AuthzGraph.prototype.traverseOut = function (nodeId) {
  return this._traverse(nodeId, this.getOutEdgesOf, 'to');
};

/**
 * Generic traversal function that will start at `nodeId`, walk along edges returned by `getEdgeFn`
 * and continue onto nodes of the edge named by `nextNodeProperty`. This is useful as a generic
 * implementation of both an inbound and outbound edge traversal
 *
 * @param  {String}     nodeId              The id of the node at which to start. This node will also be the first node in the resulting array
 * @param  {Function}   getEdgeFn           The function to apply to the graph to get the next collection of edges to walk
 * @param  {String}     nextNodeProperty    The property on the edge that returns the node that follows the edge
 * @return {Node[]}                         The array of nodes that are visited while traversing the graph
 * @api private
 */
AuthzGraph.prototype._traverse = function (
  nodeId,
  getEdgeFn,
  nextNodeProperty,
  _nodes,
  _visitedIds
) {
  _nodes = _nodes || [];
  _visitedIds = _visitedIds || {};

  // Don't visit this node if it has been visited already
  if (_visitedIds[nodeId]) {
    return;
  }

  _nodes.push(this.getNode(nodeId));
  _visitedIds[nodeId] = true;

  // Traverse edges, recursively visiting the next nodes that we haven't visited yet
  _.chain(getEdgeFn.call(this, nodeId))
    .pluck(nextNodeProperty)
    .pluck('id')
    .each((nextId) => {
      this._traverse(nextId, getEdgeFn, nextNodeProperty, _nodes, _visitedIds);
    });

  // The result should be all the nodes we accumulated into the `_nodes` array
  return _nodes;
};

export default AuthzGraph;
