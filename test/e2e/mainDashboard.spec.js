describe('-- Banana: Dashboard Tests', function() {
  var Dashboard = require('./mainDashboard.po.js');  
  var dashboard = new Dashboard();  

  it('should redirect to Fusion login page', function() {
    browser.get('index.html');

    // Ensure that the user was redirected to Fusion login page
    expect(browser.getCurrentUrl()).toEqual('http://localhost:8764/login?return=%252Fbanana%252Findex.html');

    var username = element(by.model('index.user.username'));
    var password = element(by.model('index.user.password'));

    // Type in the username and password
    // Assuming the default username = admin / password = password123
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
    dashboard.timepicker24hButton.click();

    // Ensure the time filter is set correctly.
    // It should be the only filter with the correct text value for 24h.    
    var ids = dashboard.filters;
    expect(ids.count()).toEqual(1);    
    expect(dashboard.filterValues.get(3).getText()).toEqual('from : NOW/HOUR-24HOUR');
  });

  it('should allow keyword searching', function() {
    // Get the number of total search results    
    var originalHits = dashboard.histogramLegendItem.getText();    

    // Submit a keyword search    
    var searchbox = dashboard.searchbox;
    searchbox.clear();
    searchbox.sendKeys('level_s:INFO');
    searchbox.submit();

    // Ensure that the number of search results changed
    var newHits = dashboard.histogramLegendItem.getText();
    expect(originalHits).not.toEqual(newHits);

    // Ensure there are 4 rows in the dashboard which means it's working    
    var rows = dashboard.rows;
    expect(rows.count()).toEqual(4);
  });

  it('should add a new row', function() {
    // Click to open dashboard settings    
    dashboard.settingButton.click();
    browser.sleep(1000); // Need to sleep to prevent error (sometime) with the following selector
    var tabs = dashboard.settingTabs;
    // Click on the Rows tab
    tabs.filter(function(elem, index) {
      return elem.getText().then(function(text) {
        return text === 'Rows';
      });
    }).first().click();
    
    var rowInputs = dashboard.settingRowTabRowInputs;
    // There should be 2 input elements
    expect(rowInputs.count()).toEqual(2);    
    
    var newRow = rowInputs.get(0);
    newRow.click();
    newRow.sendKeys('Test');

    // Click on Create Row button and then click on Close button    
    dashboard.settingCreateRowButton.click();    
    dashboard.settingRowTabCloseButton.click();

    // Ensure there are now 5 rows    
    var rows = dashboard.rows;
    expect(rows.count()).toEqual(5);
  });

  it('should add a new Hits panel', function() {    
    var rows = dashboard.rows;
    // Ensure there are 5 rows
    expect(rows.count()).toEqual(5);

    // Click on "Add panel to empty row" button    
    rows.get(4).element(by.css('div.row-control div.row-fluid div.panel.span12 span.ng-scope span.btn.btn-mini')).click();

    // Click on Add Panel tab    
    var tabs = dashboard.settingTabs;
    tabs.filter(function(elem, index) {
      return elem.getText().then(function(text) {
        return text === 'Add Panel';
      });
    }).first().click();

    // Hits panel option value = 9    
    var panelTypeDropdown = dashboard.settingPanelTabTypeDropdown;
    expect(panelTypeDropdown.count()).toEqual(15);
    
    // Select Hits panel from the drop-down box    
    panelTypeDropdown.get(14).click();

    // Enter title as "ID"    
    var titleInputs = dashboard.hitsPanelTitleInputs;
    expect(titleInputs.count()).toEqual(3);    
    titleInputs.get(2).sendKeys('ID');

    // Enter "id" field name    
    var fieldInputs = dashboard.hitsPanelFieldInputs;
    expect(fieldInputs.count()).toEqual(3);    
    fieldInputs.get(2).sendKeys('id');

    // Click Add Panel button  
    var addPanelbuttons = dashboard.settingPanelTabAddButtons;
    expect(addPanelbuttons.count()).toEqual(27);    
    addPanelbuttons.get(26).click();

    // Click Close button    
    var closeButtons = dashboard.settingPanelTabCloseButtons;
    expect(closeButtons.count()).toEqual(27);  
    closeButtons.get(26).click();

    // Ensure that the Hits panel is added to the last row, and it should be the only panel.    
    var panels = rows.get(4).all(by.repeater('(name, panel) in row.panels|filter:isPanel'));
    expect(panels.count()).toEqual(1);
  });
});
