{
  "targets": [
    {
      "target_name": "window_audio_capture",
      "sources": [ "src/window_audio_capture.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "defines": [ 
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "_WIN32_WINNT=0x0A00"
      ],
      "libraries": [
        "-lole32.lib",
        "-loleaut32.lib",
        "-lwinmm.lib",
        "-lpsapi.lib",
        "-luuid.lib",
		"-lmmdevapi",
		"-lavrt" 
      ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": [
            "/std:c++17"
          ]
        }
      }
    }
  ]
}