/**
 * electron-asio - Native ASIO audio support for Electron
 *
 * Uses PortAudio with ASIO backend for low-latency audio I/O
 */

#include <napi.h>
#include "asio_wrapper.h"

static bool g_initialized = false;

/**
 * Initialize PortAudio/ASIO subsystem
 */
Napi::Value Initialize(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (g_initialized) {
        return Napi::Boolean::New(env, true);
    }

    PaError err = Pa_Initialize();
    if (err != paNoError) {
        Napi::Error::New(env, std::string("PortAudio init failed: ") + Pa_GetErrorText(err))
            .ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, false);
    }

    g_initialized = true;
    return Napi::Boolean::New(env, true);
}

/**
 * Terminate PortAudio/ASIO subsystem
 */
Napi::Value Terminate(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!g_initialized) {
        return env.Undefined();
    }

    Pa_Terminate();
    g_initialized = false;
    return env.Undefined();
}

/**
 * Check if ASIO is available
 */
Napi::Value IsAvailable(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!g_initialized) {
        Initialize(info);
    }

    // Check for ASIO host API
    PaHostApiIndex asioHostApi = Pa_HostApiTypeIdToHostApiIndex(paASIO);
    return Napi::Boolean::New(env, asioHostApi >= 0);
}

/**
 * Get version info
 */
Napi::Value GetVersionInfo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    std::string version = "electron-asio v1.0.0 (PortAudio ";
    version += Pa_GetVersionText();
    version += ")";

    return Napi::String::New(env, version);
}

/**
 * Get list of ASIO devices
 */
Napi::Value GetDevices(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!g_initialized) {
        Initialize(info);
    }

    Napi::Array devices = Napi::Array::New(env);

    PaHostApiIndex asioHostApi = Pa_HostApiTypeIdToHostApiIndex(paASIO);
    if (asioHostApi < 0) {
        return devices; // No ASIO available
    }

    const PaHostApiInfo* hostApiInfo = Pa_GetHostApiInfo(asioHostApi);
    if (!hostApiInfo) {
        return devices;
    }

    uint32_t deviceIndex = 0;
    for (int i = 0; i < hostApiInfo->deviceCount; i++) {
        PaDeviceIndex devIdx = Pa_HostApiDeviceIndexToDeviceIndex(asioHostApi, i);
        const PaDeviceInfo* devInfo = Pa_GetDeviceInfo(devIdx);

        if (devInfo) {
            Napi::Object device = Napi::Object::New(env);
            device.Set("index", Napi::Number::New(env, devIdx));
            device.Set("name", Napi::String::New(env, devInfo->name));
            device.Set("hostApi", Napi::String::New(env, "ASIO"));
            device.Set("maxInputChannels", Napi::Number::New(env, devInfo->maxInputChannels));
            device.Set("maxOutputChannels", Napi::Number::New(env, devInfo->maxOutputChannels));
            device.Set("defaultSampleRate", Napi::Number::New(env, devInfo->defaultSampleRate));
            device.Set("defaultLowInputLatency", Napi::Number::New(env, devInfo->defaultLowInputLatency * 1000));
            device.Set("defaultLowOutputLatency", Napi::Number::New(env, devInfo->defaultLowOutputLatency * 1000));
            device.Set("defaultHighInputLatency", Napi::Number::New(env, devInfo->defaultHighInputLatency * 1000));
            device.Set("defaultHighOutputLatency", Napi::Number::New(env, devInfo->defaultHighOutputLatency * 1000));

            devices.Set(deviceIndex++, device);
        }
    }

    return devices;
}

/**
 * Get info for a specific device
 */
Napi::Value GetDeviceInfo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1) {
        return env.Null();
    }

    if (!g_initialized) {
        Initialize(info);
    }

    PaDeviceIndex devIdx = -1;

    if (info[0].IsNumber()) {
        devIdx = info[0].As<Napi::Number>().Int32Value();
    } else if (info[0].IsString()) {
        std::string name = info[0].As<Napi::String>().Utf8Value();

        // Search for device by name
        int numDevices = Pa_GetDeviceCount();
        for (int i = 0; i < numDevices; i++) {
            const PaDeviceInfo* devInfo = Pa_GetDeviceInfo(i);
            if (devInfo && devInfo->name == name) {
                devIdx = i;
                break;
            }
        }
    }

    if (devIdx < 0) {
        return env.Null();
    }

    const PaDeviceInfo* devInfo = Pa_GetDeviceInfo(devIdx);
    if (!devInfo) {
        return env.Null();
    }

    Napi::Object device = Napi::Object::New(env);
    device.Set("index", Napi::Number::New(env, devIdx));
    device.Set("name", Napi::String::New(env, devInfo->name));
    device.Set("hostApi", Napi::String::New(env, Pa_GetHostApiInfo(devInfo->hostApi)->name));
    device.Set("maxInputChannels", Napi::Number::New(env, devInfo->maxInputChannels));
    device.Set("maxOutputChannels", Napi::Number::New(env, devInfo->maxOutputChannels));
    device.Set("defaultSampleRate", Napi::Number::New(env, devInfo->defaultSampleRate));
    device.Set("defaultLowInputLatency", Napi::Number::New(env, devInfo->defaultLowInputLatency * 1000));
    device.Set("defaultLowOutputLatency", Napi::Number::New(env, devInfo->defaultLowOutputLatency * 1000));

    return device;
}

/**
 * Module initialization
 */
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("initialize", Napi::Function::New(env, Initialize));
    exports.Set("terminate", Napi::Function::New(env, Terminate));
    exports.Set("isAvailable", Napi::Function::New(env, IsAvailable));
    exports.Set("getVersionInfo", Napi::Function::New(env, GetVersionInfo));
    exports.Set("getDevices", Napi::Function::New(env, GetDevices));
    exports.Set("getDeviceInfo", Napi::Function::New(env, GetDeviceInfo));

    // Register AsioStream class
    AsioStream::Init(env, exports);

    return exports;
}

NODE_API_MODULE(electron_asio, Init)
