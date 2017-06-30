/**
 * Javascript Array extension
 * @module
 */
$.extend(Array.prototype, {

  /**
   * Return min value of value array
   *
   * @func Array.min
   * @example:
   *  ```js
   *  [1,2,3].min() === 1
   *  ```
   */
  min: function () {
    return this.reduce(function (x, y) {
      return ( x < y ? x : y );
    });
  },

  /**
   * Return max value of value array
   *
   * @func Array.max
   * @example:
   *  ```js
   *  [1,2,3].max() === 3
   *  ```
   */
  max: function () {
    return this.reduce(function (x, y) {
      return ( x > y ? x : y );
    });
  },

  /**
   * Return min value of objects which have property
   *
   * @param {string} prop - property name
   * @example:
   *  ```js
   *  [{name: "phuong", count: 1}, {name: "huynh", count: 2}].minBy("count") === 1
   *  ```
   */
  minBy: function(prop) {
    var values = [];
    $.each(this, function (i, v) {values.push(v[prop]);});
    return values.min();
  },

  /**
   * Return max value of objects which have property
   *
   * @param {string} prop - property name
   * @example:
   *  ```js
   *  [{name: "phuong", count: 1}, {name: "huynh", count: 2}].maxBy("count") === 2
   *  ```
   */
  maxBy: function(prop) {
    var values = [];
    $.each(this, function (i, v) {values.push(v[prop]);});
    return values.max();
  },

  /**
   * Return array of values of objects which have property
   *
   * @param {string} prop - property name
   * @example:
   *  ```js
   *  [{name: "phuong", count: 1}, {name: "huynh", count: 2}].toArray("count") === [1,2]
   *  ```
   */
  toArray : function (prop) {
    var values = [];
    $.each(this, function (i, v) {values.push(v[prop]);});
    return values;
  },

  /**
   * Random array of values using [shuffle](http://bost.ocks.org/mike/shuffle/)
   *
   * @param {string} prop - property name
   * @example:
   *  ```js
   *  [{name: "phuong", count: 1}, {name: "huynh", count: 2}].shuffle()
   *  ```
   */
  shuffle : function () {
    var m = this.length, t, i;
    while (m) {
      i = Math.floor(Math.random() * m--);
      t = this[m];
      this[m] = this[i];
      this[i] = t;
    }
    return this;
  },

  /*
   * Return an array without any duplicated value
   *
   * @param {string} prop - property name
   * @example:
   *  ```js
   *  [{name: "phuong", count: 1}, {name: "huynh", count: 2}].distinct()
   *  ```
   * */
  distinct : function () {
    var result = [];
    $.each(this, function (i, v) {
      if ($.inArray(v, result) == -1) result.push(v);
    });
    return result;
  },

  /**
   * Return object/value which has value equal to
   *
   * @param {object} val - found value
   * @param {string} prop - property name
   * @example:
   *  ```js
   *  [{name: "phuong", count: 1}, {name: "huynh", count: 2}].findFirst("phuong", "name") === {name: "phuong", count: 1}
   *  ```
   */
  findFirst : function (val, prop) {
    var index = undefined;
    $.each(this, function (i, v) {
      var value = (prop === undefined ? v : v[prop] );
      if (value === val) {
        index = i;
        return false;
      }
    });
    return this[index];
  }
});