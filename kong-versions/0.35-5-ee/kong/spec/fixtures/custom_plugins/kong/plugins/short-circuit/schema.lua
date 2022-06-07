return {
  name = "short-circuit",
  fields = {
    {
      config = {
        type = "record",
        fields = {
          { status  = { type = "integer", default = 503 }, },
          { message = { type = "string", default = "short-circuited" }, },
        },
      },
    },
  },
}
