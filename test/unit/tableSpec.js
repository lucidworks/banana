'use strict';

define([
	'angular',
	'app',
	'underscore',
	'kbn',
	'moment',
	'angular-mocks',
	'solrjs',
	'elasticjs',
	'tablePanel'
],
function(angular, app, _, kbn, moment) {
	// This is just an example test.	
	describe('just checking', function() {
		it('works for app', function() {
			var el = $('<div>require.js up and running</div>');
			expect(el.text()).toEqual('require.js up and running');
		});

		it('work for underscore', function() {
			expect(_.size([1,2,3])).toEqual(3);
		});
	});

	describe('table controller', function() {
		// Need to load these modules before start testing
		beforeEach(function() {
			module('kibana');
			module('kibana.services');
			module('kibana.controllers');
			module('kibana.directives');
			module('kibana.filters');
			module('elasticjs.service');
			module('solrjs.service');
			module('kibana.panels.table');
		});

		it('should defined table controller', inject(function($controller) {
			var scope = {};

			// Need to define scope.panel here, otherwise we will get an undefined exception
			// on 'spyable' property.
			scope.panel = {
	      status  : "Stable",
	      queries     : {
	        mode        : 'all',
	        ids         : [],
	        query       : '*:*',
	        basic_query : '',
	        custom      : ''
	      },
	      size    : 100, // Per page
	      pages   : 5,   // Pages available
	      offset  : 0,
	      sort    : ['event_timestamp','desc'],
	      group   : "default",
	      style   : {'font-size': '9pt'},
	      overflow: 'min-height',
	      fields  : [],
	      highlight : [],
	      sortable: true,
	      header  : true,
	      paging  : true,
	      field_list: true,
	      trimFactor: 300,
	      normTimes : true,
	      spyable : true,
	      saveOption : 'json',
	      exportSize: 100,
	      exportAll: true,
	      displayLinkIcon: true,
	      imageFields : [],      // fields to be displayed as <img>
	      imgFieldWidth: 'auto', // width of <img> (if enabled)
	      imgFieldHeight: '85px' // height of <img> (if enabled)
	    };

	    var ctrl = $controller('table', {$scope:scope});
			expect(ctrl).toBeDefined();

			scope.set_refresh(true);
			expect(scope.refresh).toBeTruthy();
		}));
	});

});