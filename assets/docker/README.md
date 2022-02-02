# Pongo in Docker

This folder contains some examples of how to run Pongo itself inside a container
(mostly for CI purposes).

_**WARNING**: make sure to read up on the security consequences this has! You are allowing a Docker container to control the Docker deamon on the host!_


## Prerequisites:

- the plugin source repo must be mounted into the Pongo container at
  `/pongo_wd`.
- the ID of the container running Pongo must be set in the file
  `/pongo_wd/.containerid`. See the `docker run` flag `--cidfile`.

## Examples:

The following examples are functional, and can be used as a starting point for
your own CI setup.

- the `Dockerfile` is an example file to build a container with Pongo.
- the `build.sh` script can be used to build a pongo container for a specific
  version of Pongo. See the script for variables to use.
- the `pongo-docker.sh` script is similar to a regular `pongo` command except
  that it will run Pongo from a container. See the script for variables to use.

