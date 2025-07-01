-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]


return {
  name = "translate-backwards-older-plugin",
  fields = {
    {
      config = {
        type = "record",
        fields = {
          { new_field = { type = "string", default = "new-value" } },
        },
        shorthand_fields = {
          { old_field = {
            type = "string",
            translate_backwards = { 'new_field' },
            deprecation = {
              message = "translate-backwards-older-plugin: config.old_field is deprecated, please use config.new_field instead",
              removal_in_version = "4.0", },
            func = function(value)
              return { new_field = value }
            end
          } },
        },
      },
    },
  },
}
