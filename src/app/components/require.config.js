/**
 * Bootstrap require with the needed config, then load the app.js module.
 */
require.config({
  baseUrl: 'app',
  // urlArgs: 'r=@REV@',
  paths: {
    config:                   '../config',
    settings:                 'components/settings',
    kbn:                      'components/kbn',

    css:                      '../vendor/require/css',
    text:                     '../vendor/require/text',
    moment:                   '../vendor/moment',
    filesaver:                '../vendor/filesaver',

    angular:                  '../../bower_components/angular/angular',
    'angular-dragdrop':       '../../bower_components/angular-dragdrop/src/angular-dragdrop',
    'angular-strap':          '../vendor/angular/angular-strap',
    'angular-sanitize':       '../../bower_components/angular-sanitize/angular-sanitize',
    'angular-route':          '../../bower_components/angular-route/angular-route',
    'angular-aria':           '../../bower_components/angular-aria/angular-aria',
    'angular-animate':        '../../bower_components/angular-animate/angular-animate',
    'angular-material':       '../../bower_components/angular-material/angular-material',
    'angular-smart-table':    '../../bower_components/angular-smart-table/dist/smart-table',
    'angular-translate':  '../vendor/angular/angular-translate',
    'angular-translate-loader-static-files':  '../vendor/angular/angular-translate-loader-static-files',

    timepicker:               '../vendor/angular/timepicker',
    datepicker:               '../vendor/angular/datepicker',

    underscore:               'components/underscore.extended',
    'underscore-src':         '../vendor/underscore',
    bootstrap:                '../vendor/bootstrap/bootstrap',

    jquery:                   '../vendor/jquery/jquery-1.12.1',
    cookies:                   '../vendor/jquery/jquery.cookie',
    'jquery-ui':              '../vendor/jquery/jquery-ui-1.10.3',

    'extend-jquery':          'components/extend-jquery',

    'jquery.flot':            '../vendor/jquery/jquery.flot',
    'jquery.flot.pie':        '../vendor/jquery/jquery.flot.pie',
    'jquery.flot.selection':  '../vendor/jquery/jquery.flot.selection',
    'jquery.flot.stack':      '../vendor/jquery/jquery.flot.stack',
    'jquery.flot.stackpercent':'../vendor/jquery/jquery.flot.stackpercent',
    'jquery.flot.time':       '../vendor/jquery/jquery.flot.time',
    'jquery.flot.axislabels': '../vendor/jquery/jquery.flot.axislabels',
    'showdown':               '../vendor/showdown',

    echarts:                  '../../node_modules/echarts/dist/echarts',
    'echarts-gl':     '../../node_modules/echarts-gl/dist/echarts-gl',
    'echarts-liquidfill':     '../../node_modules/echarts-liquidfill/dist/echarts-liquidfill',
    'echarts-wordcloud':     '../../node_modules/echarts-wordcloud/dist/echarts-wordcloud',
    'echarts-bmap':           '../../node_modules/echarts/dist/extension/bmap',
    'echarts-china':           '../../node_modules/echarts/map/js/china',

    modernizr:                '../vendor/modernizr-2.6.1',
    elasticjs:                '../vendor/elasticjs/elastic-angular-client',
    solrjs:                   '../vendor/solrjs/solr-angular-client',

    d3:                       '../../bower_components/d3/d3',
    viz:                    '../vendor/viz.v1.0.0.min',
    Donut3D:                  '../vendor/d3/Donut3D',
    html2canvas:              '../../bower_components/html2canvas/build/html2canvas',
    jspdf:                    '../../bower_components/jspdf/dist/jspdf.min',
    // d3transform:                    '../vendor/d3/d3-transform',
    // extarray:                     '../vendor/d3/extarray',
    // lines:                     '../vendor/d3/lines',
    // microobserver:                     '../vendor/d3/micro-observer',
    // microplugin:                     '../vendor/d3/microplugin',
    // bubble:                    '../vendor/d3/bubble-chart',
    // misc:                     '../vendor/d3/misc',
    // centralclick:                    '../vendor/d3/central-click',


    /*
    d3:                       '../vendor/d3',
      viz:                    '../vendor/viz.v1.0.0.min',
      kagi:                    '../vendor/kagi',
      bubble:                    '../vendor/d3/bubble-chart',
      centralclick:                    '../vendor/d3/central-click',
      d3transform:                    '../vendor/d3/d3-transform',
      extarray:                     '../vendor/d3/extarray',
      lines:                     '../vendor/d3/lines',
      microobserver:                     '../vendor/d3/micro-observer',
      microplugin:                     '../vendor/d3/microplugin',
      misc:                     '../vendor/d3/misc',
      d3min:                       '../vendor/d3/d3.min',
      jquerymin:                    '../vendor/d3/jquery.min',
      Donut3D:                  '../vendor/d3/Donut3D',
      bullet:                   '../vendor/d3/bullet',
      */
  },
  shim: {
    underscore: {
      exports: '_'
    },

    angular: {
      deps: ['jquery'],
      exports: 'angular'
    },

    bootstrap: {
      deps: ['jquery']
    },


    modernizr: {
      exports: 'Modernizr'
    },

    jquery: {
      exports: 'jQuery'
    },

    // simple dependency declaration
    'jquery-ui':            ['jquery'],
    'jquery.flot':          ['jquery'],
    'jquery.flot.pie':      ['jquery', 'jquery.flot'],
    'jquery.flot.selection':['jquery', 'jquery.flot'],
    'jquery.flot.stack':    ['jquery', 'jquery.flot'],
    'jquery.flot.stackpercent':['jquery', 'jquery.flot'],
    'jquery.flot.time':     ['jquery', 'jquery.flot'],
    'jquery.flot.axislabels':['jquery', 'jquery.flot'],

    'angular-sanitize':     ['angular'],
    'angular-cookies':      ['angular'],
    'angular-dragdrop':     ['jquery','jquery-ui','angular'],
    'angular-loader':       ['angular'],
    'angular-mocks':        ['angular'],
    'angular-resource':     ['angular'],
    'angular-aria':     ['angular'],
    'angular-animate':     ['angular'],
    'angular-material':        ['angular', 'angular-aria', 'angular-animate'],
    'angular-touch':        ['angular'],
    'angular-route':        ['angular'],
    'angular-strap':        ['angular', 'bootstrap','timepicker', 'datepicker'],
    'angular-smart-table':             ['angular'],
    'angular-translate' : ['angular'],
    'angular-translate-loader-static-files':['angular','angular-translate'],

    timepicker:             ['jquery', 'bootstrap'],
    datepicker:             ['jquery', 'bootstrap'],

    elasticjs:              ['angular', '../vendor/elasticjs/elastic'],
    solrjs:                 ['angular', '../vendor/solrjs/solr'],
    Donut3D:                ['d3'],
    d3transform:            ['d3'],
    bubble:                 ['d3'],
    lines:                  ['d3','bubble'],
    centralclick:           ['d3','bubble'],
      'echarts-liquidfill':   ['echarts'],
    'viz':                  ['d3'],
  }
});
