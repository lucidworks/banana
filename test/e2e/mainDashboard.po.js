module.exports = function Dashboard(){
  // Time picker 24h button
  this.timepicker24hButton = element(by.buttonText('24h'));

  // Filters in the dashboard
  this.filters = element.all(by.repeater('id in filterSrv.ids'));

  // Filter panel values
  this.filterValues = element.all(by.css('.filter-values ul li'));

  // Histogram
  this.histogramLegendItem = element(by.css('span .histogram-legend-item'));

  // Search box
  this.searchbox = element(by.css('.search-query.panel-query'));

  // Dashboard rows
  this.rows = element.all(by.repeater('(row_name, row) in dashboard.current.rows'));

  // Add panel to empty row button
  this.addPanelToEmptyRowButton = element(by.css('div.row-control div.row-fluid div.panel.span12 span.ng-scope span.btn.btn-mini'));

  // Dashboard settings button
  this.settingButton = element(by.css('a[bs-modal="\'app/partials/dasheditor.html\'"]'));
  // Tabs in dashboard settings page
  this.settingTabs = element.all(by.css('div.modal-body div.tabs ul.nav.nav-tabs li a'));

  // Rows Tab in Settings created by bs-tabs directive
  this.settingRowsTab = element(by.css('a[data-target="#tab-02K-1"]'));
  //   Row title input (use by.id is more accurate than by.css)
  this.settingNewRowTitleInput = element(by.id('newRowTitleInput'));

  //   Create row button  
  this.settingCreateRowButton = element(by.id('createRow'));  

  //   Close button
  this.settingRowTabCloseButton = element(by.css('[ng-click="editor.index=0;dismiss();reset_panel();dashboard.refresh()"]'));

  // Add Panel tab:
  //   Panel types drop-down
  this.settingPanelTabTypeDropdown = element.all(by.css('div[ng-show="editor.index == 2"] form select')).all(by.css('option[value="9"]'));
  //   Add panel buttons
  this.settingPanelTabAddButtons = element.all(by.id('rowEditorAddPanelButton'));
  //   Close buttons
  this.settingPanelTabCloseButtons = element.all(by.id('rowEditorCloseButton'));

  // Hits panel setting:
  //   Title inputs
  this.hitsPanelTitleInputs = element.all(by.css('div[ng-controller=hits] div[ng-include="\'app/partials/panelgeneral.html\'"] div div.span4 input[ng-model="panel.title"]'));
  //   Field inputs
  this.hitsPanelFieldInputs = element.all(by.css('div[ng-controller=hits] div[ng-include="edit_path(panel.type)"] div.row-fluid div.span12 table tbody tr td input[type=text][placeholder="Field name"]'));

  this.dashboardTitle = element(by.binding('dashboard.current.title'));  
  this.newButton = element(by.css('.dropdown[bs-tooltip="\'New\'"]'));
  this.newTSdashboard = element(by.css('.dropdown .dropdown-menu .link[ng-click="$scope.type=\'default-ts\'"]'));
  this.newNTSdashboard = element(by.css('.dropdown .dropdown-menu .link[ng-click="$scope.type=\'default-nts\'"]'));
  this.newDashboardCreateButtons = element.all(by.id('newDashboardCreateButton'));
};
