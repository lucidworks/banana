'use strict';

// Text that comes from documents, dashboards and the address bar must reach the page as text. These specs
// compile the real panel templates and the real alert container with values that look like HTML (the same
// kinds of value that the test dataset holds), and check what ends up in the DOM: no event-handler
// attribute, no script address, no element that the value smuggled in, while the text itself is still
// shown and highlights, links and images that belong there still work.
describe('rendering of document data', function () {
  var angular = require('angular');
  require('angular-sanitize');
  var helpers = require('./helpers/injector');
  var config = require('config');
  var kbn = require('kbn');
  require('panels/table/module');
  require('panels/fullTextSearch/module');
  require('panels/docviewer/module');
  require('panels/dashcontrol/module');
  require('panels/text/module');

  var tableTemplate = require('panels/table/module.html');
  var fullTextTemplate = require('panels/fullTextSearch/module.html');
  var docviewerTemplate = require('panels/docviewer/module.html');
  var indexTemplate = require('../../src/index.html');
  var tableMicropanel = require('panels/table/micropanel.html');
  var fullTextMicropanel = require('panels/fullTextSearch/micropanel.html');

  var IMG = '<img src=x onerror=window.xssRan=1>';
  var BREAKOUT = 'x" onmouseover="window.xssRan=1';
  var SCRIPT_URL = 'javascript:window.xssRan=1';

  // Everything in the DOM under `root` that would run script or reach a script address.
  function dangers(root) {
    var found = [];
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var node = all[i];
      if (/^(script|iframe|object|embed)$/i.test(node.nodeName)) {
        found.push('<' + node.nodeName.toLowerCase() + '>');
      }
      for (var j = 0; j < node.attributes.length; j++) {
        var attr = node.attributes[j];
        if (/^on/i.test(attr.name)) {
          found.push(node.nodeName.toLowerCase() + ' ' + attr.name);
        }
        if (/^(href|src|xlink:href)$/i.test(attr.name) && /^[\s\u0000- ]*javascript:/i.test(attr.value)) {
          found.push(node.nodeName.toLowerCase() + ' ' + attr.name + '=' + attr.value);
        }
      }
    }
    return found;
  }

  function newInjector(provided, modules) {
    return helpers.createInjector(provided, ['ngSanitize'].concat(modules || []));
  }

  // Compiles a panel template without its controller, with the given scope values.
  function render(injector, template, values) {
    var html = template.replace(/\sng-controller=(["'])[^"']*\1/, '').replace(/\sng-init=(["'])[^"']*\1/, '');
    var scope = injector.get('$rootScope').$new();
    angular.extend(scope, values);
    var element = injector.get('$compile')(angular.element('<div>' + html + '</div>'))(scope);
    scope.$digest();
    return element[0];
  }

  describe('the shared helpers', function () {
    it('highlightHtml keeps the highlight tags and escapes everything else', function () {
      expect(kbn.highlightHtml('a <mark>b</mark> <b>c</b> & "d"', '<mark>', '</mark>'))
        .toBe('a <mark>b</mark> &lt;b&gt;c&lt;/b&gt; &amp; &quot;d&quot;');
    });

    it('highlightHtml escapes everything when no tags are configured, and joins an array', function () {
      expect(kbn.highlightHtml('<mark>b</mark>', '', undefined)).toBe('&lt;mark&gt;b&lt;/mark&gt;');
      expect(kbn.highlightHtml(['<i>', 'x'], '<em>', '</em>')).toBe('&lt;i&gt;x');
      expect(kbn.highlightHtml(null, '<em>', '</em>')).toBe('');
    });

    it('highlightHtml keeps tags that hold characters with a meaning in a pattern', function () {
      expect(kbn.highlightHtml('a [b] c', '[', ']')).toBe('a [b] c');
      expect(kbn.highlightHtml('a $1 (b) c', '$1 (', ')')).toBe('a $1 (b) c');
    });

    it('isSafeUrl allows the listed schemes and addresses without a scheme only', function () {
      var web = ['http', 'https'];
      expect(kbn.isSafeUrl('http://example.test/a?b=1', web)).toBe(true);
      expect(kbn.isSafeUrl('HTTPS://example.test', web)).toBe(true);
      expect(kbn.isSafeUrl('img/a.png', web)).toBe(true);
      expect(kbn.isSafeUrl('#/dashboard/solr/x', web)).toBe(true);
      expect(kbn.isSafeUrl('mailto:a@example.test', web)).toBe(false);
      expect(kbn.isSafeUrl('javascript:alert(1)', web)).toBe(false);
      expect(kbn.isSafeUrl(' JaVa\tScRiPt:alert(1)', web)).toBe(false);
      expect(kbn.isSafeUrl('vbscript:x', web)).toBe(false);
      expect(kbn.isSafeUrl('data:text/html,<script>', web, true)).toBe(false);
      expect(kbn.isSafeUrl('data:image/png;base64,AAAA', web, false)).toBe(false);
      expect(kbn.isSafeUrl('data:image/png;base64,AAAA', web, true)).toBe(true);
    });

    it('the noXml filter turns an object into escaped JSON', function () {
      var noXml = newInjector().get('$filter')('noXml');
      expect(noXml({ a: IMG })).toBe('{&quot;a&quot;:&quot;&lt;img src=x onerror=window.xssRan=1&gt;&quot;}');
      expect(noXml([{ a: '<b>' }])).toEqual(['{&quot;a&quot;:&quot;&lt;b&gt;&quot;}']);
      expect(noXml(7)).toBe(7);
    });
  });

  describe('the document viewer', function () {
    function view(panel) {
      return render(newInjector(), docviewerTemplate, { data: [{}], docIndex: 0, panel: panel });
    }

    it('shows a title and content that hold markup as text', function () {
      var root = view({
        docTitle: IMG, docContent: 'before ' + IMG + ' <script>window.xssRan=1</script> and ' + BREAKOUT,
        simplePre: '<mark>', simplePost: '</mark>'
      });
      expect(dangers(root)).toEqual([]);
      expect(root.querySelector('img')).toBeNull();
      expect(root.textContent).toContain(IMG);
      expect(root.textContent).toContain('<script>window.xssRan=1</script>');
      expect(root.textContent).toContain(BREAKOUT);
    });

    it('still highlights the matches with the configured tags', function () {
      var root = view({
        docTitle: ['A <mark>match</mark>'], docContent: ['one <mark>two</mark> three'],
        simplePre: '<mark>', simplePost: '</mark>'
      });
      var marks = root.querySelectorAll('mark');
      expect(marks.length).toBe(2);
      expect(marks[0].textContent).toBe('match');
      expect(marks[1].textContent).toBe('two');
    });

    it('keeps only the configured tags, whatever they are', function () {
      var root = view({
        docTitle: '', docContent: '<b class="hit">x</b> <mark>y</mark>',
        simplePre: '<b class="hit">', simplePost: '</b>'
      });
      expect(root.querySelectorAll('b.hit').length).toBe(1);
      expect(root.querySelector('mark')).toBeNull();
      expect(root.textContent).toContain('<mark>y</mark>');
    });

    it('does not let a configured tag carry a handler', function () {
      var root = view({
        docTitle: '', docContent: 'a <img src=x onerror=window.xssRan=1>b</img>',
        simplePre: '<img src=x onerror=window.xssRan=1>', simplePost: '</img>'
      });
      expect(dangers(root)).toEqual([]);
    });
  });

  describe('the full text search panel', function () {
    var PANEL = { offset: 0, size: 5, body_field: 'body', header_field: 'title', url_field: 'url', trimFactor: 3000, fields: [] };

    function view(highlighted, source, extra) {
      var values = {
        panel: PANEL,
        highlight_flag: highlighted,
        highlighting: { k1: { body: ['snippet <em>match</em> ' + IMG + ' ' + BREAKOUT] } },
        highlightingKeys: ['k1'],
        data: [{ kibana: { _source: source, details: true, view: 'table' } }]
      };
      return render(newInjector({}, ['kibana.panels.fullTextSearch']), fullTextTemplate, angular.extend(values, extra));
    }

    it('shows a highlighted body that holds markup as text, and still highlights the match', function () {
      var root = view(true, { body: 'x', title: 't', url: 'http://example.test/' });
      expect(dangers(root)).toEqual([]);
      expect(root.querySelector('img')).toBeNull();
      expect(root.textContent).toContain(IMG);
      expect(root.textContent).toContain(BREAKOUT);
      var match = root.querySelector('.highlight-code b');
      expect(match).not.toBeNull();
      expect(match.textContent).toBe('match');
    });

    it('shows a body without highlighting that holds markup as text', function () {
      var root = view(false, { body: 'one ' + IMG + ' two <script>window.xssRan=1</script> ' + BREAKOUT, title: 't', url: 'http://example.test/' });
      expect(dangers(root)).toEqual([]);
      expect(root.querySelector('img')).toBeNull();
      expect(root.textContent).toContain('one ' + IMG + ' two <script>window.xssRan=1</script> ' + BREAKOUT);
    });

    it('shows a plain body unchanged', function () {
      var root = view(false, { body: 'Fish & chips, 5 > 3', title: 't', url: 'http://example.test/' });
      expect(root.textContent).toContain('Fish & chips, 5 > 3');
    });

    it('shows the values in the details table as text, and links web addresses', function () {
      var root = view(false, {
        body: 'b', title: 't', url: 'http://example.test/',
        message: 'see ' + IMG + ' at http://example.test/a?b=1 and ' + BREAKOUT,
        nested: { text: IMG },
        list: [SCRIPT_URL, 'http://example.test/?q=" onmouseover="x']
      });
      expect(dangers(root)).toEqual([]);
      expect(root.querySelector('img')).toBeNull();
      var cells = root.querySelectorAll('table table td[ng-bind-html]');
      var text = Array.prototype.map.call(cells, function (c) { return c.textContent; }).join('\n');
      expect(text).toContain('see ' + IMG + ' at ');
      expect(text).toContain(IMG);
      var link = root.querySelector('table table a[href="http://example.test/a?b=1"]');
      expect(link).not.toBeNull();
      expect(link.getAttribute('target')).toBe('_blank');
    });
  });

  describe('the table panel', function () {
    function view(panel, source, highlight) {
      return render(newInjector({}, ['kibana.panels.table']), tableTemplate, {
        panel: angular.extend({
          fields: [], imageFields: [], imgFieldWidth: '50px', imgFieldHeight: '40px', trimFactor: 3000,
          offset: 0, size: 5, header: true, enableHyperlink: false, displayLinkIcon: false,
          hyperlinkColumnForURI: 'link'
        }, panel),
        data: [{ kibana: { _source: source, highlight: highlight || {}, details: true, view: 'table' } }]
      });
    }

    var BODY_ROW = 'table tbody tr:first-child';
    var COLUMN = BODY_ROW + ' td[ng-repeat]';

    describe('columns', function () {
      it('shows a value that holds markup as text', function () {
        var root = view({ fields: ['a'] }, { a: IMG + ' ' + BREAKOUT });
        expect(dangers(root)).toEqual([]);
        expect(root.querySelector(COLUMN).textContent).toBe(IMG + ' ' + BREAKOUT);
      });

      it('still highlights with the highlight markers', function () {
        var root = view({ fields: ['a'] }, { a: 'plain' }, { a: 'one @start-highlight@two@end-highlight@ ' + IMG });
        expect(dangers(root)).toEqual([]);
        var hit = root.querySelector(COLUMN + ' code.highlight');
        expect(hit).not.toBeNull();
        expect(hit.textContent).toBe('two');
      });
    });

    describe('image columns', function () {
      function image(value) {
        var root = view({ fields: ['pic'], imageFields: ['pic'] }, { pic: value });
        return { root: root, img: root.querySelector(COLUMN + ' img'), cell: root.querySelector(COLUMN) };
      }

      it('shows the image for a web address, with the configured size', function () {
        var shown = image('http://example.test/a.png?x=1&y=2');
        expect(dangers(shown.root)).toEqual([]);
        expect(shown.img.getAttribute('src')).toBe('http://example.test/a.png?x=1&y=2');
        expect(shown.img.style.width).toBe('50px');
        expect(shown.img.style.height).toBe('40px');
      });

      it('shows the image for a relative address and for an embedded image', function () {
        expect(image('img/a.png').img.getAttribute('src')).toBe('img/a.png');
        expect(image('data:image/png;base64,iVBORw0KGgo=').img.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
      });

      it('keeps a double quote inside the address from adding an attribute', function () {
        var shown = image(BREAKOUT);
        expect(dangers(shown.root)).toEqual([]);
        expect(shown.img.attributes.length).toBe(2);
        expect(shown.img.getAttribute('src')).toBe(BREAKOUT);
      });

      it('shows an address with another scheme as text and not as an image', function () {
        ['javascript:window.xssRan=1', 'data:text/html,<script>window.xssRan=1</script>'].forEach(function (value) {
          var shown = image(value);
          expect(dangers(shown.root)).toEqual([]);
          expect(shown.img).toBeNull();
          expect(shown.cell.textContent).toBe(value);
        });
      });

      it('does not let a markup value become an element', function () {
        var shown = image(IMG);
        expect(dangers(shown.root)).toEqual([]);
        expect(shown.img.getAttribute('src')).toBe(IMG);
        expect(shown.root.querySelectorAll('img').length).toBe(1);
      });

      it('does not let the configured size end the style attribute', function () {
        var root = view({ fields: ['pic'], imageFields: ['pic'], imgFieldWidth: '1px" onmouseover="window.xssRan=1' },
          { pic: 'http://example.test/a.png' });
        expect(dangers(root)).toEqual([]);
      });
    });

    describe('the hyperlink columns', function () {
      function links(displayLinkIcon, value) {
        var root = view({ enableHyperlink: true, displayLinkIcon: displayLinkIcon }, { link: value });
        var filter = displayLinkIcon ? 'urlLinkAsIcon' : 'urlLink';
        return { root: root, cell: root.querySelector(BODY_ROW + ' td[ng-bind-html*="| ' + filter + ' |"]') };
      }

      [false, true].forEach(function (icon) {
        var kind = icon ? 'link icon' : 'link';

        it('shows markup in the value as text with the ' + kind + ' column', function () {
          var shown = links(icon, 'go to ' + IMG + ' ' + BREAKOUT + ' ' + SCRIPT_URL);
          expect(dangers(shown.root)).toEqual([]);
          expect(shown.root.querySelector('img')).toBeNull();
          expect(shown.cell.querySelector('a')).toBeNull();
          if (!icon) {
            expect(shown.cell.textContent).toBe('go to ' + IMG + ' ' + BREAKOUT + ' ' + SCRIPT_URL);
          }
        });

        it('still links a web address with the ' + kind + ' column', function () {
          var shown = links(icon, 'http://example.test/a?b=1&c=2');
          var anchor = shown.cell.querySelector('a');
          expect(anchor.getAttribute('href')).toBe('http://example.test/a?b=1&c=2');
          expect(anchor.getAttribute('target')).toBe('_blank');
          if (icon) {
            expect(anchor.className).toContain('icon-search');
          } else {
            expect(anchor.textContent).toBe('http://example.test/a?b=1&c=2');
          }
        });

        it('does not let an address carry an attribute with the ' + kind + ' column', function () {
          var shown = links(icon, 'http://example.test/?q=" onmouseover="window.xssRan=1 http://example.test/<img src=x onerror=window.xssRan=1>');
          expect(dangers(shown.root)).toEqual([]);
          expect(shown.root.querySelector('img')).toBeNull();
        });
      });

      it('shows a number', function () {
        expect(links(false, 42).cell.textContent).toBe('42');
      });
    });

    describe('the details of a row', function () {
      it('shows values that hold markup as text, and links web addresses', function () {
        var root = view({}, { a: IMG, b: BREAKOUT, c: { nested: IMG }, d: ['see http://example.test/x', SCRIPT_URL] });
        expect(dangers(root)).toEqual([]);
        expect(root.querySelector('img')).toBeNull();
        expect(root.textContent).toContain(IMG);
        expect(root.querySelector('table table a[href="http://example.test/x"]')).not.toBeNull();
      });
    });
  });

  describe('tooltips that show a value', function () {
    function tooltip(template, scopeValues) {
      var expression = /bs-tooltip="([^"]*field\[0\][^"]*)"/.exec(template)[1];
      var injector = newInjector();
      var scope = injector.get('$rootScope').$new();
      angular.extend(scope, scopeValues);
      return scope.$eval(expression);
    }

    [['table', tableMicropanel], ['full text search', fullTextMicropanel]].forEach(function (pair) {
      it('escapes the value in the ' + pair[0] + ' field list (a tooltip shows its text as HTML)', function () {
        var text = tooltip(pair[1], {
          field: [IMG, 3], percent: function () { return '10%'; }, micropanel: { count: 3 }, data: [1, 2, 3]
        });
        expect(text).toBe('&lt;img src=x onerror=window.xssRan=1&gt; (10%)');
      });
    });
  });

  describe('the tooltip of the query panel', function () {
    it('escapes the query text (a tooltip shows its text as HTML)', function () {
      var queryTemplate = require('panels/query/module.html');
      var expression = /bs-tooltip="([^"]*querySrv\.list\[id\]\.query[^"]*)"/.exec(queryTemplate)[1];
      var scope = newInjector().get('$rootScope').$new();
      scope.id = 0;
      scope.querySrv = { list: { 0: { query: 'status:' + IMG + ' ' + BREAKOUT } } };
      expect(scope.$eval(expression)).toBe('status:&lt;img src=x onerror=window.xssRan=1&gt; x&quot; onmouseover=&quot;window.xssRan=1');
    });
  });

  describe('the alert container', function () {
    // The alert part of index.html, with the same bindings
    var alertHtml = indexTemplate.substring(
      indexTemplate.indexOf("<div ng-repeat='alert in dashAlerts.list'"),
      indexTemplate.indexOf('<div class="navbar navbar-static-top">')
    );

    function show(alertSrv, injector) {
      var scope = injector.get('$rootScope').$new();
      scope.dashAlerts = alertSrv;
      var element = injector.get('$compile')(angular.element('<div>' + alertHtml + '</div>'))(scope);
      scope.$digest();
      return element[0];
    }

    it('has the markup that the alert test needs', function () {
      expect(alertHtml).toContain('ng-bind-html=');
    });

    it('shows text that holds markup as text, but keeps the markup that alerts use', function () {
      var injector = newInjector();
      var alertSrv = injector.get('alertSrv');
      alertSrv.set('Title ' + IMG, 'Could not load <i>dashboards/' + kbn.escapeHtml(IMG) + '</i> ' + IMG + ' <script>window.xssRan=1</script>', 'error');
      var root = show(alertSrv, injector);
      expect(dangers(root)).toEqual([]);
      // the sanitizer leaves an img element in a text that holds one, but without its address
      expect(root.querySelector('img[src]')).toBeNull();
      expect(root.querySelector('i').textContent).toBe('dashboards/' + IMG);
      expect(root.textContent).toContain('Title ' + IMG);
    });

    it('does not show an escaped value twice escaped', function () {
      var injector = newInjector();
      var alertSrv = injector.get('alertSrv');
      alertSrv.set('t', 'named "' + kbn.escapeHtml('<b>&amp; "x"') + '"', 'error');
      expect(show(alertSrv, injector).querySelector('span[ng-bind-html]').textContent).toBe('named "<b>&amp; "x""');
    });

    it('drops a script address from a link', function () {
      var injector = newInjector();
      var alertSrv = injector.get('alertSrv');
      alertSrv.set('t', 'see <a href="' + SCRIPT_URL + '">here</a> or <a href="https://example.test/">there</a>', 'info');
      var root = show(alertSrv, injector);
      expect(dangers(root)).toEqual([]);
      expect(root.querySelector('a[href="https://example.test/"]')).not.toBeNull();
    });

    // The alerts that existed in 1.6.30 and quote a dashboard title or an id from the dashboard list.
    describe('alerts from the dashboard menu', function () {
      var injector;
      var dashboard;
      var scope;
      var savedFusion;

      beforeEach(function () {
        savedFusion = config.USE_FUSION;
        config.USE_FUSION = false;
        dashboard = helpers.fakeDashboard();
        dashboard.current.title = IMG;
        dashboard.current.loader = { save_temp_ttl_enable: false };
        injector = newInjector({ dashboard: dashboard }, ['kibana.panels.dashcontrol']);
        var $q = injector.get('$q');
        dashboard.set_default = function () { return true; };
        dashboard.elasticsearch_save = function () { return $q.when({ response: { docs: [{ id: IMG }] }, id: IMG }); };
        dashboard.save_gist = function () { return $q.when('https://gist.example.test/"><img src=x onerror=window.xssRan=1>'); };
        dashboard.share_link = function () { return {}; };
        scope = injector.get('$rootScope').$new();
        scope.config = config;
      });

      afterEach(function () {
        config.USE_FUSION = savedFusion;
      });

      function check(titleSnippet) {
        var alertSrv = injector.get('alertSrv');
        injector.get('$rootScope').$digest();
        expect(alertSrv.list.length).toBe(1);
        var root = show(alertSrv, injector);
        expect(dangers(root)).toEqual([]);
        expect(root.querySelector('img')).toBeNull();
        expect(root.textContent).toContain(titleSnippet);
        return root;
      }

      function loader() {
        injector.get('$controller')('dashLoader', { $scope: scope });
        scope.init();
      }

      function dashcontrol() {
        scope.panel = {};
        scope.elasticsearch = { title: '', dashboards: [] };
        injector.get('$controller')('dashcontrol', { $scope: scope });
      }

      it('menu: "Local Default Set" quotes the dashboard title as text', function () {
        loader();
        scope.set_default();
        check(IMG + ' has been set as your local default');
      });

      it('menu: "Dashboard Saved" quotes the title as text', function () {
        loader();
        scope.elasticsearch_save('dashboard');
        check('saved to Solr as "' + IMG + '"');
      });

      it('menu: "Dashboard Deleted" quotes the id as text', function () {
        loader();
        dashboard.elasticsearch_delete = function () { return injector.get('$q').when({ responseHeader: { status: 0 } }); };
        scope.elasticsearch_delete(IMG);
        check(IMG + ' has been deleted');
      });

      it('menu: "Dashboard Not Found" quotes the id as text', function () {
        loader();
        dashboard.elasticsearch_delete = function () { return injector.get('$q').when({ responseHeader: { status: 1 } }); };
        scope.elasticsearch_delete(IMG);
        check('Could not find ' + IMG + ' in Solr');
      });

      it('menu: the gist alert links the address and shows it as text', function () {
        loader();
        scope.gist = { title: 'g' };
        scope.save_gist();
        var root = check('https://gist.example.test/"><img src=x onerror=window.xssRan=1>');
        expect(root.querySelectorAll('a').length).toBe(1);
        expect(root.querySelector('a').getAttribute('href')).toMatch(/^https:\/\/gist\.example\.test\//);
      });

      it('dashboard control panel: "Local Default Set" quotes the title as text', function () {
        dashcontrol();
        scope.set_default();
        check(IMG + ' has been set as your local default');
      });

      it('dashboard control panel: "Dashboard Saved" quotes the id as text', function () {
        dashcontrol();
        scope.elasticsearch_save('dashboard');
        check('saved to Solr as "' + IMG + '"');
      });

      it('dashboard control panel: "Dashboard Deleted" quotes the id as text', function () {
        dashcontrol();
        dashboard.elasticsearch_delete = function () { return injector.get('$q').when({ found: true }); };
        scope.elasticsearch_delete(IMG);
        check(IMG + ' has been deleted');
      });

      it('dashboard control panel: "Dashboard Not Found" quotes the id as text', function () {
        dashcontrol();
        dashboard.elasticsearch_delete = function () { return injector.get('$q').when({ found: false }); };
        scope.elasticsearch_delete(IMG);
        check('Could not find ' + IMG + ' in Solr');
      });

      it('dashboard control panel: the gist alert links the address and shows it as text', function () {
        dashcontrol();
        scope.gist = { title: 'g' };
        scope.save_gist();
        var root = check('https://gist.example.test/"><img src=x onerror=window.xssRan=1>');
        expect(root.querySelectorAll('a').length).toBe(1);
      });
    });
  });

  describe('markdown', function () {
    // The real `markdown` element of the text panel: the spec compiles it with the panel's content and
    // checks the DOM that it renders. The element loads the converter asynchronously, so the check runs
    // when it has written its result.
    function markdown(source, check, done) {
      var injector = newInjector({}, ['kibana.panels.text']);
      var scope = injector.get('$rootScope').$new();
      scope.panel = { mode: 'markdown', content: source };
      var element = injector.get('$compile')(angular.element('<div><markdown></markdown></div>'))(scope);
      var started = Date.now();
      (function wait() {
        var root = element[0].querySelector('markdown');
        if (root.children.length > 0 || Date.now() - started > 3000) {
          expect(root.children.length).toBeGreaterThan(0);
          check(root);
          done();
        } else {
          setTimeout(wait, 10);
        }
      })();
    }

    // an `it` whose body is given the rendered element
    function renders(name, source, check) {
      it(name, function (done) {
        markdown(source, check, done);
      });
    }

    renders('still renders text, emphasis, lists, code and headings',
      '# Title\n\nSome *emphasis* and **strong** text with `code`.\n\n* one\n* two\n', function (root) {
        expect(root.querySelector('h1').textContent).toBe('Title');
        expect(root.querySelector('em').textContent).toBe('emphasis');
        expect(root.querySelector('strong').textContent).toBe('strong');
        expect(root.querySelector('code').textContent).toBe('code');
        expect(root.querySelectorAll('li').length).toBe(2);
      });

    renders('keeps a heading id and the language of a code block', '## Section one\n\n```js\nvar a = 1;\n```\n', function (root) {
      expect(root.querySelector('h2').getAttribute('id')).toBe('sectionone');
      expect(root.querySelector('pre code').textContent).toContain('var a = 1;');
      expect(root.querySelector('pre code').className).toBe('js');
    });

    renders('shows raw HTML in the text as text', 'before ' + IMG + ' <script>window.xssRan=1</script> after', function (root) {
      expect(dangers(root)).toEqual([]);
      expect(root.querySelector('img')).toBeNull();
      expect(root.textContent).toContain(IMG);
    });

    renders('keeps links to web pages, mail addresses, other dashboards and anchors',
      '[a](http://example.test/a?b=1&c=2) [b](https://example.test/) [c](mailto:me@example.test) ' +
      '[d](#/dashboard/solr/Home) [e](/relative/page) [f](http://example.test/x "A title")', function (root) {
        var hrefs = Array.prototype.map.call(root.querySelectorAll('a'), function (a) { return a.getAttribute('href'); });
        expect(hrefs).toEqual(['http://example.test/a?b=1&c=2', 'https://example.test/', 'mailto:me@example.test',
          '#/dashboard/solr/Home', '/relative/page', 'http://example.test/x']);
        expect(root.querySelectorAll('a')[5].getAttribute('title')).toBe('A title');
        expect(root.querySelectorAll('a')[0].textContent).toBe('a');
      });

    renders('removes the address of a link that uses another scheme',
      '[x](javascript:window.xssRan=1) [y](JaVaScRiPt:window.xssRan=1) [z](data:text/html;base64,AAAA) ' +
      '[w](vbscript:x) [v](java\tscript:window.xssRan=1)', function (root) {
        expect(dangers(root)).toEqual([]);
        expect(root.querySelectorAll('a[href]').length).toBe(0);
        expect(root.textContent).toContain('x');
      });

    renders('does not let a double quote in an address or a title add an attribute',
      '[x](http://example.test/" onmouseover="window.xssRan=1) ' +
      '[y](http://example.test/ "t\\" onmouseover=\\"window.xssRan=1") ![i](http://example.test/a.png" onerror="window.xssRan=1)',
      function (root) {
        expect(dangers(root)).toEqual([]);
      });

    renders('keeps images from web addresses, relative addresses and embedded images',
      '![a](http://example.test/a.png "T") ![b](img/b.png) ![c](data:image/png;base64,iVBORw0KGgo=)', function (root) {
        var srcs = Array.prototype.map.call(root.querySelectorAll('img'), function (i) { return i.getAttribute('src'); });
        expect(srcs).toEqual(['http://example.test/a.png', 'img/b.png', 'data:image/png;base64,iVBORw0KGgo=']);
        expect(root.querySelector('img').getAttribute('alt')).toBe('a');
        expect(root.querySelector('img').getAttribute('title')).toBe('T');
      });

    renders('removes an image address that uses another scheme',
      '![a](javascript:window.xssRan=1) ![b](data:text/html;base64,AAAA) ![c](mailto:me@example.test)', function (root) {
        expect(dangers(root)).toEqual([]);
        expect(root.querySelectorAll('img[src]').length).toBe(0);
      });
  });

  describe('chart labels written as HTML', function () {
    it('escapes the term in a pie slice label and keeps the percentage', function () {
      var html = kbn.pieLabelHtml(IMG + ' ' + BREAKOUT + " it's", { percent: 41.6 });
      var root = document.implementation.createHTMLDocument('').createElement('div');
      root.innerHTML = html;
      expect(dangers(root)).toEqual([]);
      expect(root.querySelector('img')).toBeNull();
      expect(root.textContent).toBe(IMG + ' ' + BREAKOUT + " it's42%");
    });

    it('labels a plain term as before', function () {
      var root = document.implementation.createHTMLDocument('').createElement('div');
      root.innerHTML = kbn.pieLabelHtml('error', { percent: 12 });
      expect(root.textContent).toBe('error12%');
      expect(root.querySelector('br')).not.toBeNull();
    });
  });
});
