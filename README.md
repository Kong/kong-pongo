# kong-ee-plugin-test
experimental; EE images capable of running plugin tests


## requirements
Have a docker image of Kong 0.36-1, tagged as `kong-ee`

## Do a test run
Enter a plugin directory, and run the `plugin-dev.sh` script from there.

Note: the first run will build some stuff and hence be slower.

```shell
# get into a plugin repo
cd ~/code/kong-plugin-route-transformer

# run the script to execute the plugin tests
~/code/kong-ee-plugin-test/plugin-dev.sh
```
