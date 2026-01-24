{
  "targets": [
    {
      "target_name": "electron_asio",
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "sources": [
        "src/addon.cc",
        "src/asio_wrapper.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "deps/portaudio/include"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS", "PA_USE_ASIO=1" ],
      "conditions": [
        ["OS=='win'", {
          "libraries": [
            "-l<(module_root_dir)/deps/portaudio/lib/portaudio_x64.lib"
          ],
          "copies": [{
            "destination": "<(module_root_dir)/build/Release/",
            "files": ["<(module_root_dir)/deps/portaudio/lib/portaudio_x64.dll"]
          }],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1
            }
          }
        }]
      ]
    }
  ]
}
