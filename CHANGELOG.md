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
    * example where/how to make the change: https://github.com/Kong/kong-ee/pull/11257. Copy the to-do list from the PR description!
    * make sure it passes, adjust if required
 * merge the Pongo release branch, tag as `x.y.z`, and push the tag
 * in Github UI create a release from the tag
 * update Kong-Enterprise PR (created in the first step)
    * Change the Pongo version to use to the newly released version of Pongo
    * remove "draft" status.

---

## 2.24.0 released 04-Dec-2025

* Chore: disable the test coverage by default.
  [#713](https://github.com/Kong/kong-pongo/pull/713)

* Feat: Kong Enterprise 3.11.0.1

* Feat: Kong Enterprise 3.11.0.2

* Feat: Kong Enterprise 3.11.0.3

* Feat: Kong Enterprise 3.11.0.4

* Feat: Kong Enterprise 3.11.0.5

* Feat: Kong Enterprise 3.11.0.6

* Feat: Kong Enterprise 3.10.0.4

* Feat: Kong Enterprise 3.10.0.5

* Feat: Kong Enterprise 3.10.0.6

* Feat: Kong Enterprise 3.9.1.2

* Feat: Kong Enterprise 3.8.1.2

* Feat: Kong Enterprise 3.4.3.21

## 2.23.0 released 02-Dec-2025

* Fix: use version v2 of docker-compose for the base image.
  [#711](https://github.com/Kong/kong-pongo/pull/711)

* Feat: Kong Enterprise 3.12.0.1

## 2.22.0 released 22-Nov-2025

* Feat: Kong Enterprise 3.4.3.22
* Chore: clean up images after test to free up space.
  [#709](https://github.com/Kong/kong-pongo/pull/709)

## 2.21.0 released 03-Oct-2025

* Feat: Kong Enterprise 3.12.0.0

## 2.20.0 released 08-Aug-2025

* Feat: make custom CA bundle available during image build

## 2.19.0 released 08-Jul-2025

* Feat: support loading custom CA certificates file in PEM format
  via the environment variable `PONGO_CUSTOM_CA_CERT` or
  the `--custom-ca-cert` CLI option.

* Feat: Kong OSS 3.9.1

* Feat: Kong Enterprise 3.4.3.19

* Feat: Kong Enterprise 3.11.0.0

* Feat: Kong Enterprise 3.4.3.20

* Feat: Kong Enterprise 3.10.0.3

## 2.18.0 released 24-Jun-2025

* Fix: Update Luarocks to 3.12.1.

* Feat: Kong Enterprise 2.8.4.13

* Feat: Kong Enterprise 3.8.1.1

* Feat: Kong Enterprise 3.7.1.5

* Feat: Kong Enterprise 2.8.4.14

* Feat: Kong Enterprise 3.10.0.1

* Feat: Kong Enterprise 3.4.3.18

* Feat: Kong Enterprise 3.10.0.2

## 2.17.0 released 31-Mar-2025

* Feat: Kong Enterprise 3.10.0.0

* Feat: Kong Enterprise 3.9.1.1

* Feat: Kong Enterprise 3.9.1.0

* Feat: Kong Enterprise 3.9.0.1

* Feat: Kong Enterprise 3.7.1.4

* Feat: Kong Enterprise 3.4.3.17


## 2.16.0 released 21-Jan-2025

* Fix: warning in docker file.
  [#647](https://github.com/Kong/kong-pongo/pull/647)

* Fix: check for `md5` availability in platform indepedent way.
  Removes need to install coreutils on Mac.
  [#642](https://github.com/Kong/kong-pongo/pull/642).

* Feat: Kong Enterprise 3.4.3.16

* Feat: Kong Enterprise 3.4.3.15

* Feat: Kong Enterprise 3.4.3.14

---

## 2.15.0 released 17-Dec-2024

* Fix: pass http-proxy variables when building `expose`
  [#637](https://github.com/Kong/kong-pongo/pull/637).

* Feat: prepare for LuaCov html reporter (in LuaCov 0.16.0)
  [#638](https://github.com/Kong/kong-pongo/pull/638).

* Feat: Kong Enterprise 3.9.0.0

* Feat: Kong Enterprise 3.8.1.0

* Feat: Kong Enterprise 3.7.1.3

* Feat: Kong Enterprise 3.6.1.8

* Feat: Kong Enterprise 3.4.3.13

* Feat: Kong OSS 3.9.0

---

## 2.14.0 released 24-Sep-2024

* Feat: enable FIPS support for plugin testing
  [#624](https://github.com/Kong/kong-pongo/pull/624).

---

## 2.13.0 released 12-Sep-2024

* Fix: properly resolve Kong-versions in case of double digits, eg. 3.4.3.12
  [#619](https://github.com/Kong/kong-pongo/pull/619).

* Fix: remove version key from docker compose to prevent deprecation warning
  [#622](https://github.com/Kong/kong-pongo/pull/622).

* Feat: Kong Enterprise 3.8.0.0

* Feat: Kong Enterprise 3.6.1.7

* Feat: Kong Enterprise 3.4.3.12

* Feat: Kong Enterprise 2.8.4.12

* Feat: Kong OSS 3.8.0

---

## 2.12.0 released 16-Jul-2024

* refactor: for updating switch from `hub` to the offical Github `gh` cli command.
  [#596](https://github.com/Kong/kong-pongo/pull/596).

* Feat: Kong Enterprise 3.7.1.2

* Feat: Kong Enterprise 3.7.1.1

* Feat: Kong Enterprise 3.6.1.6

* Feat: Kong Enterprise 3.6.1.5

* Feat: Kong Enterprise 3.6.1.4

* Feat: Kong Enterprise 3.5.0.7

* Feat: Kong Enterprise 3.5.0.6

* Feat: Kong Enterprise 3.5.0.5

* Feat: Kong Enterprise 3.5.0.4

* Feat: Kong Enterprise 3.4.3.11

* Feat: Kong Enterprise 3.4.3.9

* Feat: Kong Enterprise 3.4.3.8

* Feat: Kong Enterprise 3.4.3.7

* Feat: Kong Enterprise 2.8.4.11

* Feat: Kong Enterprise 2.8.4.10

* Feat: Kong OSS 3.7.1

* Feat: Kong OSS 2.8.5

---

## 2.11.1 released 30-May-2024

* Fix: if no health-checks are defined for a dependency then assume it to be healthy.
  [#563](https://github.com/Kong/kong-pongo/pull/563).

---

## 2.11.0 released 29-May-2024

* Feat: add `HEALTH_TIMEOUT` option to not hang forever if a dependency container
  fails to start properly. Defaults to 60 (seconds). Also deprecates `SERVICE_DISABLE_HEALTCHECK`,
  since that can now be done using `HEALTH_TIMEOUT=0`.
  [#554](https://github.com/Kong/kong-pongo/pull/554).

* Feat: Kong Enterprise 3.7.0.0

* Feat: Kong Enterprise 3.6.1.3

* Feat: Kong Enterprise 3.6.1.2

* Feat: Kong Enterprise 3.6.1.1

* Feat: Kong Enterprise 3.6.1.0

* Feat: Kong Enterprise 3.6.0.0

* Feat: Kong Enterprise 3.4.3.6

* Feat: Kong Enterprise 3.4.3.5

* Feat: Kong Enterprise 3.4.3.4

* Feat: Kong Enterprise 2.8.4.9

* Feat: Kong Enterprise 2.8.4.8

* Feat: Kong Enterprise 2.8.4.7

* Feat: Kong OSS 3.7.0

* Feat: Kong OSS 3.6.1

* Feat: Kong OSS 3.6.0

---

## 2.10.0 released 08-Feb-2024

* Feat: add automatic reloads for interactive shells. This will watch plugin files as
  well as the dbless config file and reload upon changes.
  [#504](https://github.com/Kong/kong-pongo/pull/504).

* Feat: support access to host runner's services.
  [#473](https://github.com/Kong/kong-pongo/pull/473).

* Feat: provide more feedback when using a custom image.
  [#524](https://github.com/Kong/kong-pongo/pull/524).

* Feat: Kong Enterprise 3.5.0.3

* Feat: Kong Enterprise 3.5.0.2

* Feat: Kong Enterprise 3.5.0.1

* Feat: Kong Enterprise 3.4.3.3

* Feat: Kong Enterprise 3.4.3.2

* Feat: Kong Enterprise 3.4.3.1

* Feat: Kong Enterprise 3.4.2.0

* Feat: Kong Enterprise 2.8.4.6

* Feat: Kong Enterprise 2.8.4.5

* Fix: include the Pongo version in the generated image names to prevent running
  older images after a Pongo upgrade. A new image will automatically be build now.
  [#516](https://github.com/Kong/kong-pongo/pull/516).

* Fix: fail if the compose-up command fails. To prevent hanging while waiting for a
  health-check to go healthy.
  [#522](https://github.com/Kong/kong-pongo/pull/522).

* Fix: do not fail the build if httpie cannot be installed. Now continues the
  build since it is optional.
  [#515](https://github.com/Kong/kong-pongo/pull/515).

* Fix: the --debug option will now output full buildlogs again using buildkit
  [#513](https://github.com/Kong/kong-pongo/pull/513).

* Fix: kms alias will exit when starting Kong fails.
  [#503](https://github.com/Kong/kong-pongo/pull/503).

* Fix: proxy config will be passed upon build and again on run.
  [#514](https://github.com/Kong/kong-pongo/pull/514).

* Fix: health-checks on Pongo container. Use proper prefix.
  [#456](https://github.com/Kong/kong-pongo/pull/456).

* Fix: version resolving, EE versions have 2 patch versions, now Pongo will resolve
  them both. So 3.4.1.x now resolves to latest within 3.4, being 3.4.2.0.
  [#477](https://github.com/Kong/kong-pongo/pull/477).

* Chore: remove deprecated docker repo.
  [#475](https://github.com/Kong/kong-pongo/pull/475).

* Chore: remove some deadcode and remnants of Pulp usage.
  [#523](https://github.com/Kong/kong-pongo/pull/523).

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
