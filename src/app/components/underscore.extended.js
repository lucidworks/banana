define([
  'underscore-src'
],
function () {
  'use strict';

  var _ = window._;

  /*
    Mixins :)
  */
  _.mixin({

  	/**
  	 * Move an item from one position in the array to a different position within the array
  	 *
  	 * @param {Array}   array      The
  	 * @param {Integer} fromIndex  The index of the item to be moved
  	 * @param {Integer} toIndex    The new index of where the item should be placed within the array
  	 * @return {Array}             A copy of the array with the item in question moved to its new location
  	 */
    move: function (array, fromIndex, toIndex) {
      array.splice(toIndex, 0, array.splice(fromIndex, 1)[0] );
      return array;
    },


  	/**
  	 * Remove a single item from an array
  	 *
  	 * @param {Array}   array  The subject
  	 * @param {Integer} index  0-based index of the item to be removed
  	 * @return {Array}         A copy of the array with the item removed
  	 */
    remove: function (array, index) {
      array.splice(index, 1);
      return array;
    },


  	/**
  	 * Toggle the presence of an item within an array; ie: push an element if it's not already present within the array, or remove it from the array if it is already present
  	 *
  	 * @param {Array} array  The subject
  	 * @param {Mixed} value  The item to be added or removed from the array
  	 * @return Array         A copy of the array with the item in question added/removed
  	 */
    toggleInOut: function(array,value) {
      if(_.contains(array,value)) {
        array = _.without(array,value);
      } else {
        array.push(value);
      }
      return array;
    }
  });

  return _;
});