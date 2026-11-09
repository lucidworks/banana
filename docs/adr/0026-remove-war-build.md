# 0026. Remove the WAR build and other unused build files

Date: 2026-11-06
Status: Accepted. This record supersedes the WAR consequence in [ADR 0009](0009-webpack-build.md) and the `WEB-INF` note in [ADR 0023](0023-docker-image.md).

## Context

The repository carried two older ways of building and publishing Banana next to the current webpack build (`npm run build`, which writes `dist/`):

- An Ant descriptor (`build.xml` with `default.properties`) that packaged the application into a WAR file, and a Maven descriptor (`pom.xml`, `mvn.template`) that described the WAR for publishing to a Maven repository. A Jetty context file (`jetty-contexts/banana-context.xml`) told Solr 4 and 5 where to find the WAR.
- A web application descriptor (`src/WEB-INF/web.xml`) that only the WAR used.

None of this is part of the current build or the tests. The Ant descriptor was changed to package `dist/` when the bundler was introduced and has not been run since, the Maven descriptor named a different version than the one in `package.json` (the two disagreed with each other and with the application), and the WAR targeted Solr 4 and 5, which are long out of support. Solr 6 and later, and Fusion, do not use a WAR for static content.

Other leftovers had the same problem:

- Four Jetty jar files in `resources/enable-cors/`, from 2013, plus two full copies of Jetty's default web descriptors there that allowed every origin (`*`). The jars are binary files of old third-party code with no way to check them, and the copies encouraged an unsafe configuration.
- Three logo images of a bundled Solr distribution (`src/img/silklogo*.png`, `src/img/silklogo.jpg`). No page, stylesheet or dashboard displays them; the only mention is a line in `src/index.html` that is commented out, and that was already the case in release 1.6.30.
- Linter settings (`.jshintrc`, `.jshintignore`) for a tool that the project no longer runs.
- Ignore rules for the Maven and Ant outputs, and none for editor and merge leftovers.
- The version number was written in five places: `package.json`, `pom.xml`, `default.properties`, the release notes heading of the README and the dashboard editor template, and the values differed.

## Options considered

- **Repair the WAR build and keep it.** Rejected. It would need a Java toolchain in CI that nothing else uses, for a packaging format that the Solr versions people run today do not use. `dist/` is plain static files, and every hosting route below works with it directly.
- **Keep the files but mark them unsupported.** Rejected: unused build files that look supported cost every newcomer time, and they would still need to be kept consistent.
- **Keep the old Jetty jars for convenience.** Rejected: many Solr releases already include Jetty's own CORS filter jar, and the guide now says to use the jar that matches the Solr in use if yours does not. Shipping a 2013 jar next to a security-sensitive instruction is the wrong default.
- **Replace the logo images with a neutral image.** Not needed: nothing displays them, so there is no visible change against release 1.6.30 to compensate for.

## Decision

- Removed `build.xml`, `pom.xml`, `mvn.template`, `default.properties`, `jetty-contexts/`, `src/WEB-INF/web.xml` (and the build step that copied it into `dist/`), the three logo images, the four jars and the two web descriptor copies in `resources/enable-cors/`, `.jshintrc` and `.jshintignore`. The CI configuration for Travis had already been removed.
- The README no longer describes a WAR or the publishing steps for Maven Central. The supported ways to host the build are:
  1. copy the contents of `dist/` into any web server (with a reverse proxy to Solr, or Fusion, so that the browser sees one origin);
  2. copy `dist/` into a `banana` directory inside the web application directory of a Solr installation (standalone Solr mode);
  3. build and run the container image from the `Dockerfile` in this repository. The image is for Fusion only (it proxies one Fusion gateway and has no Solr preset), and it is built by whoever needs it: it is not published to a registry ([ADR 0023](0023-docker-image.md)).
- `resources/enable-cors/README.md` is rewritten. It uses an explicit origin in the example, warns against `*`, especially together with credentials, and names no jar files; where Jetty or Solr versions matter it tells the reader to check the documentation for their own version.
- The version is defined in one place, `package.json`. The dashboard editor template carries a placeholder that the build replaces with that version, so the text shown in the editor is unchanged (`Banana v` followed by the version in `package.json`). The README heading for the release notes no longer repeats the number. A test (`test/node/single-version.test.js`) fails when a second literal copy of the version appears in a source file with a text extension (`.js`, `.json`, `.html`, `.css`, `.md`, `.xml`, `.yml`, `.yaml`, `.properties`, `.txt`, `.template`, and the `NOTICE`, `LICENSE` and `QUICKSTART` files; of `docker/` it reads only files with a listed extension, which today is `docker/extract-settings.js`; it does not read the `Dockerfile` (at the repository root) or the extensionless `docker/` files such as the entrypoint, or the `.sh`, `.jq`, `.conf` and `.cgi` files, and it skips `docs/`, vendored code and fixtures), when a removed build file comes back, or when the built `dist/` still contains the placeholder.
- `.gitignore` now covers `.DS_Store` and `*.orig`, and no longer lists the Maven and Ant outputs.

## Consequences

- No WAR file can be built from this repository. Anyone who deployed the WAR to Solr 4 or 5 with the Jetty context file has to copy `dist/` instead; the page URL under Solr's web application directory is `.../banana/index.html` rather than `/banana`.
- Solr 4 and 5 are not covered by the documented hosting routes beyond what the README says about copying `dist/` and enabling CORS.
- Whoever publishes Banana to a package registry or Maven repository later has to add that deliberately; nothing here prepares for it.
- Update, 2026-11-07: the `Dockerfile` still has a harmless `rm -rf dist/WEB-INF` from the time the build copied the descriptor; it removes nothing now.
- The shipped `dist/` no longer has a `WEB-INF` directory. A servlet container that served `dist/` as a web application would apply its own default descriptor instead; the removed descriptor only declared the default servlet and `index.html` as the welcome file, which are the defaults.
- Removing the logo images, the linter settings and the jars changes nothing the application shows or does.
