'use strict';

describe('Table controllers', function() {
  
  describe('table', function(){

    beforeEach(module('kibana.panels.table'));
    it('should defined table controller', inject(function($controller) {
      var scope = {},
          ctrl = $controller('table', {$scope:scope});

      expect(ctrl).toBeDefined();
    }));

  });
});