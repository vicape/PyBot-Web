idf_component_register(
    SRCS "zb_coord_main.c" "zb_host_proto.c"
    INCLUDE_DIRS "."
    REQUIRES nvs_flash driver esp_timer
)
