# Changelog

#### releasing new versions

 * create a release branch for Pongo; `release/x.y.z`
    * update the changelog below
    * update version in logo at top of the [`README.md`](README.md)
    * update version in `pongo.sh`
    * commit as `release x.y.z`
    * push the release branch, and create a Pongo PR
 * manually test with Kong-Enterprise
    * create a PR that changes Kong-Enterprise tests to use the Pongo release branch
    * add a link in the PR description to the Pongo release PR for cross-referencing
    * mark the PR as "draft"
    * example where/how to make the change: https://github.com/Kong/kong-ee/pull/4156. Copy the to-do list from the PR description!
    * make sure it passes, adjust if required
 * merge the Pongo release branch, tag as `x.y.z`, and push the tag
 * in Github UI create a release from the tag
 * update Kong-Enterprise PR (created in the first step)
    * Change the Pongo version to use to the newly released version of Pongo
    * remove "draft" status.

---

## unreleased

* Fix: health-checks on Pongo container. Use proper prefix.
  [#456](https://github.com/Kong/kong-pongo/pull/456).

* Fix: version resolving, EE versions have 2 patch versions, now Pongo will resolve
  them both. So 3.4.1.x now resolves to latest within 3.4, being 3.4.2.0.
  [#477](https://github.com/Kong/kong-pongo/pull/477).

* Feat: support access to host runner's services.
  [#473](https://github.com/Kong/kong-pongo/pull/473).

* Chore: remove deprecated docker repo.
  [#475](https://github.com/Kong/kong-pongo/pull/475).

---

## 2.9.0 released 08-Nov-2023

* Feat: Kong Enterprise 3.5.0.0

* Feat: Kong OSS 3.5.0

---

## 2.8.0 released 24-Oct-2023

* Fix: `pongo down` would not remove volumes. This
  caused orphaned volumes on long running VMs as well as on personal
  machines.
  [#448](https://github.com/Kong/kong-pongo/pull/448).

* Fix: drop the `--progress` flag from docker commands when building. Since
  the flag isn't always available.
  [#449](https://github.com/Kong/kong-pongo/pull/449).

* Feat: Kong Enterprise 3.4.1.1

* Feat: Kong Enterprise 3.4.1.0

* Feat: Kong Enterprise 3.4.0.0

* Feat: Kong Enterprise 3.3.1.1

* Feat: Kong Enterprise 3.3.1.0

* Feat: Kong Enterprise 3.2.2.1

* Feat: Kong Enterprise 3.2.2.2

* Feat: Kong Enterprise 3.2.2.3

* Feat: Kong Enterprise 3.2.2.4

* Feat: Kong Enterprise 3.2.2.5

* Feat: Kong Enterprise 3.1.1.6

* Feat: Kong Enterprise 3.1.1.5

* Feat: Kong Enterprise 2.8.4.4

* Feat: Kong Enterprise 2.8.4.3

* Feat: Kong OSS 3.4.2

* Feat: Kong OSS 3.4.1

* Feat: Kong OSS 3.4.0

* Feat: Kong OSS 3.3.1

* Feat: Kong OSS 2.8.4

---

## 2.7.0 released 7-Jul-2023

* Feat: Kong Enterprise 2.8.4.2, which means that Pongo 2.x will support the
  Kong Enterprise 2.8.x.x LTS releases

* Feat: Kong Enterprise 3.3.0.0

* Feat: Kong OSS 3.3.0

* Feat: add alias to enable authentication when in a Pongo shell
  [#392](https://github.com/Kong/kong-pongo/pull/392).

* Feat: the 'kms' alias will now confirm importing a file if found
  [#393](https://github.com/Kong/kong-pongo/pull/393).

* Feat: in a shell, add symlink `/rockstree` pointing to the LuaRocks tree
  [#402](https://github.com/Kong/kong-pongo/pull/402).

* Feat: support disabling dependency health checks globally by setting ENV `SERVICE_DISABLE_HEALTHCHECK=true`
  [#404](https://github.com/Kong/kong-pongo/pull/404).

---

## 2.6.0 released 23-Mar-2023

* Feat: Kong OSS 3.2.2

* Feat: Kong Enterprise 3.2.2.0

* Feat: Kong Enterprise 3.2.1.0

* Fix: Add missing `fuser` and `netstat` utility that is required for certain test functions
  [#384](https://github.com/Kong/kong-pongo/pull/384).

* Fix: compile rocks using the Kong shipped crypto libraries
  [#382](https://github.com/Kong/kong-pongo/pull/382).

* Fix: setting the LD_PATH broke some other tools. If needed now has to be set
  on a per-plugin basis.
  [#390](https://github.com/Kong/kong-pongo/pull/390).

---

## 2.5.0 released 7-Feb-2023

* Fix: Apple recently started shipping `realpath` in their OS. But it doesn't support the
  `--version` flag, so it was not detected as installed
  [#380](https://github.com/Kong/kong-pongo/pull/380).

* Feat: Kong Enterprise 3.1.1.3

* Feat: Kong Enterprise 3.1.1.2

---

## 2.4.0 released 20-Jan-2023

* Fix: Redis certificates [#370](https://github.com/Kong/kong-pongo/pull/370)

* Feat: Kong Enterprise 3.1.1.1

* Feat: Kong Enterprise 3.1.1.0

* Feat: Kong Enterprise 3.0.2.0

* Feat: Kong OSS 3.1.1

* Feat: Kong OSS 3.0.2

* Feat: Kong OSS 2.8.2

## 2.3.0 released 9-Dec-2022

* Feat: Kong Enterprise 3.1.0.0

* Feat: Kong Enterprise 3.0.1.0

* Feat: Kong OSS 3.1.0

---

## 2.2.0 released 18-Nov-2022

* Feat: Only build Python from source if the Kong base image is based
  on Ubuntu 16.04

---

## 2.1.0 released 15-Nov-2022

* Feat: Kong OSS 3.0.1

* Feat: add the Pongo version that build the image to the image, and check it
  against the used version to inform user of mismatches.

* Fix: import declarative config in Enterprise versions (officially not supported)
  in the 'kms' shell alias.

* Style: change redis cluster service name from `rc` to `redis-clusters`.
  Refer to PR <https://github.com/Kong/kong-pongo/pull/344>.

---

## 2.0.0 released 20-Oct-2022

#### Upgrading

* Upgrade Pongo

  * run `pongo clean` using the `1.x` version of Pongo, to cleanup old artifacts
    and images

  * `cd` into the folder where Pongo resides and do a `git pull`, followed by
    `git checkout 2.0.0`

* Upgrade Plugin repositories

  * on your plugin repositories run `pongo init` to update any settings (git-ignoring
    bash history mostly)

  * if your test matrix for Kong versions to test against include Kong CE versions prior
    to `2.0` or Kong EE versions prior to `3.0` then update the CI to use the proper
    version of Pongo that supports those versions. So pick a Pongo version depending
    on the Kong version being tested.

  * if your test matrix for Kong versions to test against includes `nightly`
    and/or `nightly-ee` then those should respectively be updated to `dev` and
    `dev-ee`.

  * If you need Cassandra when testing, then ensure in the plugin repositories that
    the `.pongo/pongorc` file contains: `--cassandra`, since it is no longer started
    by default.

  * Update test initialization scripts `.pongo/pongo-setup.sh`. They will now be
    sourced in `bash` instead of in `sh`.

#### Changes

* [BREAKING] the Kong base image is now `Ubuntu` (previously `Alpine`). The default
  shell now is `/bin/bash` (was `/bin/sh`)

* [BREAKING] Support for Kong Enterprise versions before `3.0` is dropped (this is
  because for Enterprise there were never Ubuntu images published in the 2.x range)

* [BREAKING] Support for Kong opensource versions before `2.0` is dropped

* [BREAKING] Cassandra is no longer started by default.

* [BREAKING] The version tags to test against Kong development branches; `nightly`
  and `nightly-ee` have been renamed to `dev` and `dev-ee` (because they are not
  nightlies but the latest commit to the master branch)

* Feat: new tags have been defined to test against the latest stable/released
  versions of Kong and Kong Enterprise; `stable` and `stable-ee`

* Fix: if the license cannot be downloaded the license variable would contain the
  404 html response, which would cause unrelated problems. The variable is now
  cleared upon failure.

---

## 1.3.0 released 19-Sep-2022

* Feat: Kong Enterprise 3.0.0.0

* Feat: Kong OSS 3.0.0

* Fix: change the `kong` user to the ID of the `/kong-plugin` folder owner, to
  prevent permission issues when starting Kong (access to the `servroot` working
  directory which is located in the mounted folder)
  [#321](https://github.com/Kong/kong-pongo/pull/321)

* Fix: location of the unofficial Kong image (used between releasing and
  Docker hub availability).

---

## 1.2.1 released 09-Sep-2022

 * Fix: format for reedis cluster support
   [#318](https://github.com/Kong/kong-pongo/pull/318)

 * Fix: workaround for https://github.com/Kong/kong/issues/9365
   [#314](https://github.com/Kong/kong-pongo/pull/314)

---

## 1.2.0 released 01-Sep-2022

* Feat: Kong Enterprise 2.8.1.2, 2.8.1.3, 2.8.1.4

* Added a Pongo github action, see the [marketplace](https://github.com/marketplace/actions/kong-pongo)

* Enabled redis cluster tests
  [#305](https://github.com/Kong/kong-pongo/pull/305)

* Export the new `KONG_SPEC_TEST_REDIS_HOST` variable to be compatible with Kong 3.0.0+
  [#290](https://github.com/Kong/kong-pongo/pull/290)

* Aliases now support `.yml` and `.json` extension for declarative config file
  [#296](https://github.com/Kong/kong-pongo/pull/296)

* Changed nightly-ee image to the new `master` tag
  [#300](https://github.com/Kong/kong-pongo/pull/300)

* Added new alias "kx" for export, and added explanation when shelling
  [#311](https://github.com/Kong/kong-pongo/pull/311)

---

## 1.1.0 released 14-Jun-2022

* Feat: Kong Enterprise 2.6.1.0, 2.7.2.0, 2.8.0.0, 2.8.1.0, 2.8.1.1

* Feat: Kong OSS 2.4.2, 2.5.2, 2.6.1, 2.7.2, 2.8.0, 2.8.1

* Feat: Enable SSL for Redis on port `6380`
  [#270](https://github.com/Kong/kong-pongo/pull/270)

* Feat: The `--debug` flag now also sets docker build command to `--progress plain`
  for easier debugging of the build. It also does `set -x` so be careful not
  to copy-paste secrets somewhere!!
  [#283](https://github.com/Kong/kong-pongo/pull/283)

* Change: Upgrade image `redis:5.0.4-alpine` to `redis:6.2.6-alpine`

* Fix: Packing rocks was limited to single-digit rockspec revisions
  [#289](https://github.com/Kong/kong-pongo/pull/289)

* Fix: Add `python3-dev` package to fix the `httpie` installation
  [#283](https://github.com/Kong/kong-pongo/pull/283)

* Fix: Fix rock installation issue due to unauthenticated Git protocol
  [#266](https://github.com/Kong/kong-pongo/pull/266)

* Fix: Upgrade cassandra image from 3.9 to 3.11 for M1 chip
  [#269](https://github.com/Kong/kong-pongo/pull/269)

---

## 1.0.0 released 1-Feb-2022

* Initial versioned release of Pongo
