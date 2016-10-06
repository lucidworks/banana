'use strict';

describe('Main Dashboard Test', function() {

  it('should redirect to Fusion login page', function() {
    browser.get('index.html');

    // Ensure that the user was redirected to Fusion login page
    expect(browser.getCurrentUrl()).toEqual('http://localhost:8764/login?return=%252Fbanana%252Findex.html');

    var username = element(by.model('index.user.username'));
    var password = element(by.model('index.user.password'));

    // Type in the username and password
    username.sendKeys('admin');
    password.sendKeys('password123');

    // Click on the login button
    element(by.id('submit')).click();

    // Ensure that the user was redirected to Banana dashboard
    // NOTE: Need to sleep to avoid error: document unloaded while waiting for result
    browser.sleep(1000);
    expect(browser.getCurrentUrl()).toEqual('http://localhost:8764/banana/index.html#/dashboard');
  });

  it('should allow selecting a time in the time picker', function() {
    expect(browser.getCurrentUrl()).toEqual('http://localhost:8764/banana/index.html#/dashboard');

    // Click on the 24h button of time picker
    element(by.buttonText('24h')).click();

    // Ensure the time filter is set correctly.
    // It should be the only filter with the correct text value for 24h.
    var ids = element.all(by.repeater('id in filterSrv.ids'));
    expect(ids.count()).toEqual(1);
    element.all(by.css('.filter-values ul li')).then(function(filters) {
      expect(filters[3].getText()).toEqual('from : NOW/HOUR-24HOUR');
    });
  });

  it('should allow keyword searching', function() {
    // Get the number of total search results
    var originalHits = element(by.css('span .histogram-legend-item')).getText(); // WORKS!!!

    // Submit a keyword search
    var searchbox = element(by.css('.search-query.panel-query'));
    searchbox.clear();
    searchbox.sendKeys('level_s:INFO');
    searchbox.submit();

    // Ensure that the number of search results changed
    var newHits = element(by.css('span .histogram-legend-item')).getText();
    expect(originalHits).not.toEqual(newHits);

    // Ensure there are 4 rows in the dashboard which means it's working
    var rows = element.all(by.repeater('(row_name, row) in dashboard.current.rows'));
    expect(rows.count()).toEqual(4);
  });

  it('should add a new row', function() {
    // Click to open dashboard settings
    element(by.css('a[bs-modal="\'app/partials/dasheditor.html\'"]')).click();

    // element(by.linkText('Rows')).click();
    // var panes = element(by.model('editor.index')).all(by.repeater('pane in panes'));

    // Ensure there are 4 tabs: General, Rows, Controls, and Solr.
    // expect(panes.count()).toEqual(4);

    browser.sleep(1000); // Need to sleep to prevent error (sometime) with the following selector
    var tabs = element.all(by.css('div.modal-body div.tabs ul.nav.nav-tabs li a'));
      // .element(by.model('editor.index'))
      // .element(by.repeater('pane in panes').row(1))
      // .element(by.css('a'))
      // .click();
      // .all(by.repeater('pane in panes'));

    // expect(tabs.count()).toEqual(1);

    // Click on the Rows tab
    tabs.filter(function(elem, index) {
      // console.log('index =', index, ', elem =', elem.getText());
      // expect(elem.getText()).toEqual('');
      return elem.getText().then(function(text) {
        return text === 'Rows';
      });
    }).first().click();

    // Type in the row name as "Test"
    // var rowInputs = element.all(by.css('div.modal-body div div.row-fluid form div input[placeholder="New row"]'));
    var rowInputs = element.all(by.css('div.modal-body div div.row-fluid form div input[ng-model="row.title"][placeholder="New row"]'));

    // var rowInputs = element.all(by.css('div.modal-body div div.row-fluid form div.span5 input.input-large[type=text][placeholder="New row"]'));
    // var rowInputs = element.all(by.css('div#app-partials-dasheditor-00L div.modal-body div div.row-fluid form div input[placeholder="New row"]'));

    // There should be 2 input elements
    expect(rowInputs.count()).toEqual(2);
    rowInputs.then(function(inputs) {
      // var EC = protractor.ExpectedConditions;
      // browser.wait(EC.visibilityOf(inputs[0]), 5000);
      // TODO Fix flaky issue
      // 2000, 3000 sometime NOT WORKING!
      // browser.sleep(2000);

      // Need to click() first to fix the test failed issue "element not visible"
      inputs[0].click();

      // browser.actions().mouseMove(inputs[0]).click().perform();

      // browser.executeScript('arguments[0].scrollIntoView();', inputs[0].getWebElement());
      // inputs[0].click();

      inputs[0].sendKeys('Test');
    });

    // Click on Create Row button and then click on Close button
    element(by.buttonText('Create Row')).click();
    element(by.css('[ng-click="editor.index=0;dismiss();reset_panel();dashboard.refresh()"]')).click();
    // var closeButtons = element.all(by.buttonText('Close'));
    // expect(closeButtons.count()).toEqual(1);

    // Ensure there are now 5 rows
    var rows = element.all(by.repeater('(row_name, row) in dashboard.current.rows'));
    expect(rows.count()).toEqual(5);
  });

  it('should add a new panel', function() {
    var rows = element.all(by.repeater('(row_name, row) in dashboard.current.rows'));
    // Ensure there are 5 rows
    expect(rows.count()).toEqual(5);
    // Click on "Add panel to empty row" button
    rows.then(function(row) {
      // row[4].element(by.cssContainingText('div.row-control div.row-fluid div.panel.span12 span.ng-scope span.btn.btn-mini', 'Add panel to empty row')).click();
      row[4].element(by.css('div.row-control div.row-fluid div.panel.span12 span.ng-scope span.btn.btn-mini')).click();
    });

    // Click on + button to add a panel => NOT WORKING!
    // var addPanels = element.all(by.css('div.modal-body div.row-fluid div.span12 h4 i.icon-plus-sign.link[bs-tooltip="\'Add panel\'"]'));
    // var addPanels = element.all(by.css('i.icon-plus-sign.link[bs-tooltip="\'Add panel\'"][ng-click="editor.index = 2"]'));
    // var addPanels = element.all(by.css('div#app-partials-roweditor-0WU div.modal-body div.row-fluid[ng-show="editor.index == 1"] div h4 i'));

    // Click on Add Panel tab
    var tabs = element.all(by.css('div.modal-body div.tabs ul.nav.nav-tabs li a'));
    tabs.filter(function(elem, index) {
      return elem.getText().then(function(text) {
        return text === 'Add Panel';
      });
    }).first().click();

    // Select a Hits panel from drop-down box
    // var panelTypeDropdown = element.all(by.model('panel.type'));  // 27
    // var panelTypeDropdown = element.all(by.model('panel.type')).all(by.options('panelType for panelType in config.panel_names|stringSort')); // 345

    // var panelTypeDropdown = element.all(by.options('panelType for panelType in config.panel_names|stringSort'));  // 345
    // var panelTypeDropdown = element.all(by.css('div.modal-body div.row-fluid form.form-inline select[ng-model="panel.type"][ng-options="panelType for panelType in config.panel_names|stringSort"]'));  // 27

    // var panelTypeDropdown = element.all(by.css('div[ng-show="editor.index == 2"]')); // 29
    // var panelTypeDropdown = element.all(by.css('div[ng-show="editor.index == 2"] form select')); // 27
    // var panelTypeDropdown = element.all(by.css('div[ng-show="editor.index == 2"] form select')).all(by.css('option[value="9"]'));  // 15
    // var panelTypeDropdown = element.all(by.css('div[ng-show="editor.index == 2"] form select')).all(by.css('option')); // 345
    // var panelTypeDropdown = element.all(by.css('div[ng-show="editor.index == 2"] form select option')); // 345

    // Hits panel option value = 9
    var panelTypeDropdown = element.all(by.css('div[ng-show="editor.index == 2"] form select')).all(by.css('option[value="9"]'));
    expect(panelTypeDropdown.count()).toEqual(15);

    // FOR DEBUGGING
    // panelTypeDropdown.each(function(elem, index) {
    //   elem.getText().then(function(text) {
    //     console.log(index, text);
    //   });
    // });

    // Select Hits panel from the drop-down box
    panelTypeDropdown.then(function(options) {
      options[14].click();
    });

    // Enter title as "ID"
    var titleInputs = element.all(by.css('div[ng-controller=hits] div[ng-include="\'app/partials/panelgeneral.html\'"] div div.span4 input[ng-model="panel.title"]'));
    expect(titleInputs.count()).toEqual(3);
    titleInputs.then(function(inputs) {
      inputs[2].sendKeys('ID');
    });

    // Enter "id" field name
    var fieldInputs = element.all(by.css('div[ng-controller=hits] div[ng-include="edit_path(panel.type)"] div.row-fluid div.span12 table tbody tr td input[type=text][placeholder="Field name"]'));
    expect(fieldInputs.count()).toEqual(3);
    fieldInputs.then(function(inputs) {
      inputs[2].sendKeys('id');
    });

    // Click Add Panel button
    var addPanelbuttons = element.all(by.buttonText('Add Panel')); // 27
    // var buttons = element.all(by.css('div.modal-footer button[ng-show="panel.type && editor.index == 2"]')); // 27
    // var buttons = element.all(by.css('div.modal-footer button[ng-click="add_panel(row,panel); reset_panel(); editor.index == 1;"]')); // 27
    // element(by.css('[ng-click="add_panel(row,panel); reset_panel(); editor.index == 1;"]')).click(); // ERROR: not visible

    expect(addPanelbuttons.count()).toEqual(27);
    addPanelbuttons.then(function(button) {
      button[26].click();
    });

    // Click Close button
    // element(by.css('[ng-click="editor.index=0;dismiss();reset_panel();close_edit()"]')).click(); // ERROR: not visible
    var closeButtons = element.all(by.css('button[ng-click="editor.index=0;dismiss();reset_panel();close_edit()"]')); // 27
    expect(closeButtons.count()).toEqual(27);
    closeButtons.then(function(button) {
      button[26].click();
    });

    // Ensure that the Hits panel is added to the last row, and it should be the only panel.
    rows.then(function(row) {
      var panels = row[4].all(by.repeater('(name, panel) in row.panels|filter:isPanel'));
      expect(panels.count()).toEqual(1);
    });
  });

  // should load Fusion Metrics dashboard

  // should load Citibike dashboard

});
