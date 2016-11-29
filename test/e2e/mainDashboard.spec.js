describe('-- Banana: Dashboard Tests', function(){
  
  var Dashboard = require('./mainDashboard.po.js');  
  // var Headerbar = require('../headerbar/headerbar.po.js');

  var dashboard = new Dashboard();
  // var hb = new Headerbar();

  var EC = protractor.ExpectedConditions;

  // beforeAll(function() {
  //   // browser.get(browser.baseUrl + '/banana/index.html#/dashboard');
  //   // browser.refresh();
  //   hb.selectContextFromHeader('Analytics');
  //   browser.wait(EC.visibilityOf(dashboard.timepicker24hButton), 20000);
  // });

  // afterAll(function() {
  //   browser.get(browser.baseUrl + '/launcher');
  // });  

  // This the login spec, in order to authenticate with Fusion and proceed with the other specs.
  it('should redirect to Fusion login page', function(){
    browser.get('index.html');

    // Ensure that the user was redirected to Fusion login page
    expect(browser.getCurrentUrl()).toContain('http://localhost:8764/login?return=%252Fbanana%252Findex.html');

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

  it('should allow selecting a time in the time picker', function(){
    expect(browser.getCurrentUrl()).toEqual('http://localhost:8764/banana/index.html#/dashboard');

    // Click on the 24h button of time picker    
    dashboard.timepicker24hButton.click();

    // Ensure the time filter is set correctly.
    // It should be the only filter with the correct text value for 24h.    
    var ids = dashboard.filters;
    expect(ids.count()).toEqual(1);    
    expect(dashboard.filterValues.get(3).getText()).toEqual('from : NOW/HOUR-24HOUR');
  });

  it('should allow keyword searching', function(){
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

  // TODO Fix this flaky test, sometimes it will fail with "Element not visible" error.
  // describe('Add a new row and a panel test:', function(){
  //   it('should add a new row', function(){
  //     // Click to open dashboard settings    
  //     dashboard.settingButton.click();
  //     // browser.sleep(2000); // Need to sleep to prevent error (sometime) with the following selector
  //     // var tabs = dashboard.settingTabs;
  //     // // Click on the Rows tab
  //     // tabs.filter(function(elem, index) {
  //     //   return elem.getText().then(function(text) {
  //     //     return text === 'Rows';
  //     //   });
  //     // }).first().click();      
  //     browser.wait(EC.elementToBeClickable(dashboard.settingRowsTab), 3000);
  //     dashboard.settingRowsTab.click();

  //     dashboard.settingNewRowTitleInput.click();
  //     dashboard.settingNewRowTitleInput.sendKeys('Test');

  //     // Click on Create Row button and then click on Close button    
  //     dashboard.settingCreateRowButton.click();    
  //     dashboard.settingRowTabCloseButton.click();

  //     // Ensure there are now 5 rows    
  //     var rows = dashboard.rows;
  //     expect(rows.count()).toEqual(5);
  //   });

  //   it('should add a new Hits panel', function(){    
  //     var rows = dashboard.rows;
  //     // Ensure there are 5 rows
  //     expect(rows.count()).toEqual(5);

  //     // Click on "Add panel to empty row" button    
  //     rows.get(4).element(by.css('div.row-control div.row-fluid div.panel.span12 span.ng-scope span.btn.btn-mini')).click();

  //     // Click on Add Panel tab    
  //     var tabs = dashboard.settingTabs;
  //     tabs.filter(function(elem, index) {
  //       return elem.getText().then(function(text) {
  //         return text === 'Add Panel';
  //       });
  //     }).first().click();

  //     // Hits panel option value = 9    
  //     var panelTypeDropdown = dashboard.settingPanelTabTypeDropdown;
  //     expect(panelTypeDropdown.count()).toEqual(15);
      
  //     // Select Hits panel from the drop-down box    
  //     panelTypeDropdown.get(14).click();

  //     // Enter title as "ID"    
  //     var titleInputs = dashboard.hitsPanelTitleInputs;
  //     expect(titleInputs.count()).toEqual(3);    
  //     titleInputs.get(2).sendKeys('ID');

  //     // Enter "id" field name    
  //     var fieldInputs = dashboard.hitsPanelFieldInputs;
  //     expect(fieldInputs.count()).toEqual(3);    
  //     fieldInputs.get(2).sendKeys('id');

  //     // Click Add Panel button      
  //     dashboard.settingPanelTabAddButtons.last().click();

  //     // Click Close button    
  //     dashboard.settingPanelTabCloseButtons.last().click();

  //     // Ensure that the Hits panel is added to the last row, and it should be the only panel.    
  //     var panels = rows.get(4).all(by.repeater('(name, panel) in row.panels|filter:isPanel'));
  //     expect(panels.count()).toEqual(1);
  //   });
  // });  

  describe('Sample dashboards tests:', function(){

    it('Lucidworks Fusion Signals dashboard should load', function(){
      browser.get('index.html#/dashboard/file/lucidworks-signals.json');
      expect(dashboard.dashboardTitle.getText()).toEqual('Fusion Signals');
    });

    it('Metrics Dashboard should load', function(){
      browser.get('index.html#/dashboard/file/lucidworks-metrics.json');
      expect(dashboard.dashboardTitle.getText()).toEqual('Fusion Metrics');
    });

    it('Search Analytics dashboard should load', function(){
      browser.get('index.html#/dashboard/file/lucidworks-searchanalytics.json')
      expect(dashboard.dashboardTitle.getText()).toEqual('Search Analytics');
    });
  });

  describe('Create new dashboard tests:', function(){

    it('should create a new time-series dashboard', function(){
      dashboard.newButton.click();
      dashboard.newTSdashboard.click();
      // Need to sleep here to avoid error because the newDashboardCreateButton element loads slowly.
      browser.sleep(3000);
      dashboard.newDashboardCreateButtons.first().click();      
      expect(dashboard.dashboardTitle.getText()).toEqual('New Time Series Dashboard');
    });

    it('should create a new non time-series dashboard', function(){
      dashboard.newButton.click();
      dashboard.newNTSdashboard.click();
      // Need to sleep here to avoid error because the newDashboardCreateButton element loads slowly.
      browser.sleep(3000);
      dashboard.newDashboardCreateButtons.get(1).click();      
      expect(dashboard.dashboardTitle.getText()).toEqual('New Non-Time Series Dashboard');
    });
  });
});
