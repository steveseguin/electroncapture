/**
 * AsioStream implementation
 */

#include "asio_wrapper.h"
#include <cstring>

Napi::FunctionReference AsioStream::constructor;

Napi::Object AsioStream::Init(Napi::Env env, Napi::Object exports) {
    Napi::HandleScope scope(env);

    Napi::Function func = DefineClass(env, "AsioStream", {
        InstanceMethod("start", &AsioStream::Start),
        InstanceMethod("stop", &AsioStream::Stop),
        InstanceMethod("close", &AsioStream::Close),
        InstanceMethod("setProcessCallback", &AsioStream::SetProcessCallback),
        InstanceMethod("write", &AsioStream::Write),
        InstanceAccessor("isRunning", &AsioStream::GetIsRunning, nullptr),
        InstanceAccessor("inputLatency", &AsioStream::GetInputLatency, nullptr),
        InstanceAccessor("outputLatency", &AsioStream::GetOutputLatency, nullptr),
        InstanceAccessor("sampleRate", &AsioStream::GetSampleRate, nullptr),
        InstanceAccessor("bufferSize", &AsioStream::GetBufferSize, nullptr),
        InstanceAccessor("inputChannelCount", &AsioStream::GetInputChannelCount, nullptr),
        InstanceAccessor("outputChannelCount", &AsioStream::GetOutputChannelCount, nullptr),
        InstanceAccessor("stats", &AsioStream::GetStats, nullptr),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("AsioStream", func);
    return exports;
}

AsioStream::AsioStream(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<AsioStream>(info),
      stream_(nullptr),
      deviceIndex_(-1),
      sampleRate_(48000),
      bufferSize_(256),
      inputChannels_(2),
      outputChannels_(0),
      isRunning_(false),
      isClosed_(false),
      hasCallback_(false),
      callbackCount_(0),
      inputUnderflows_(0),
      outputUnderflows_(0),
      writePos_(0) {

    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "Config object expected").ThrowAsJavaScriptException();
        return;
    }

    Napi::Object config = info[0].As<Napi::Object>();

    // Parse config
    if (config.Has("device")) {
        if (config.Get("device").IsNumber()) {
            deviceIndex_ = config.Get("device").As<Napi::Number>().Int32Value();
        }
    }
    if (config.Has("deviceIndex")) {
        deviceIndex_ = config.Get("deviceIndex").As<Napi::Number>().Int32Value();
    }
    if (config.Has("sampleRate")) {
        sampleRate_ = config.Get("sampleRate").As<Napi::Number>().DoubleValue();
    }
    if (config.Has("bufferSize")) {
        bufferSize_ = config.Get("bufferSize").As<Napi::Number>().Uint32Value();
    }
    if (config.Has("framesPerBuffer")) {
        bufferSize_ = config.Get("framesPerBuffer").As<Napi::Number>().Uint32Value();
    }

    // Parse input/output channels
    if (config.Has("inputChannels")) {
        Napi::Value val = config.Get("inputChannels");
        if (val.IsArray()) {
            inputChannels_ = val.As<Napi::Array>().Length();
        } else if (val.IsNumber()) {
            inputChannels_ = val.As<Napi::Number>().Int32Value();
        }
    }
    if (config.Has("channels")) {
        inputChannels_ = config.Get("channels").As<Napi::Number>().Int32Value();
    }
    if (config.Has("outputChannels")) {
        Napi::Value val = config.Get("outputChannels");
        if (val.IsArray()) {
            outputChannels_ = val.As<Napi::Array>().Length();
        } else if (val.IsNumber()) {
            outputChannels_ = val.As<Napi::Number>().Int32Value();
        }
    }

    // Use default ASIO device if not specified
    if (deviceIndex_ < 0) {
        PaHostApiIndex asioHostApi = Pa_HostApiTypeIdToHostApiIndex(paASIO);
        if (asioHostApi >= 0) {
            const PaHostApiInfo* hostInfo = Pa_GetHostApiInfo(asioHostApi);
            if (hostInfo && hostInfo->deviceCount > 0) {
                deviceIndex_ = Pa_HostApiDeviceIndexToDeviceIndex(asioHostApi, 0);
            }
        }
    }

    // Validate device
    const PaDeviceInfo* devInfo = Pa_GetDeviceInfo(deviceIndex_);
    if (!devInfo) {
        Napi::Error::New(env, "Invalid ASIO device").ThrowAsJavaScriptException();
        return;
    }

    // Clamp channels to device capabilities
    if (inputChannels_ > devInfo->maxInputChannels) {
        inputChannels_ = devInfo->maxInputChannels;
    }
    if (outputChannels_ > devInfo->maxOutputChannels) {
        outputChannels_ = devInfo->maxOutputChannels;
    }

    // Open stream
    PaStreamParameters inputParams = {};
    PaStreamParameters outputParams = {};
    PaStreamParameters* pInput = nullptr;
    PaStreamParameters* pOutput = nullptr;

    if (inputChannels_ > 0) {
        inputParams.device = deviceIndex_;
        inputParams.channelCount = inputChannels_;
        inputParams.sampleFormat = paFloat32;
        inputParams.suggestedLatency = devInfo->defaultLowInputLatency;
        inputParams.hostApiSpecificStreamInfo = nullptr;
        pInput = &inputParams;
    }

    if (outputChannels_ > 0) {
        outputParams.device = deviceIndex_;
        outputParams.channelCount = outputChannels_;
        outputParams.sampleFormat = paFloat32;
        outputParams.suggestedLatency = devInfo->defaultLowOutputLatency;
        outputParams.hostApiSpecificStreamInfo = nullptr;
        pOutput = &outputParams;
    }

    PaError err = Pa_OpenStream(
        &stream_,
        pInput,
        pOutput,
        sampleRate_,
        bufferSize_,
        paClipOff,
        PaCallback,
        this
    );

    if (err != paNoError) {
        std::string errMsg = "Failed to open ASIO stream: ";
        errMsg += Pa_GetErrorText(err);
        Napi::Error::New(env, errMsg).ThrowAsJavaScriptException();
        return;
    }

    // Pre-allocate write buffer
    writeBuffer_.resize(bufferSize_ * outputChannels_ * 4);
}

AsioStream::~AsioStream() {
    if (!isClosed_) {
        if (stream_) {
            if (isRunning_) {
                Pa_StopStream(stream_);
            }
            Pa_CloseStream(stream_);
        }
    }
}

int AsioStream::PaCallback(
    const void* inputBuffer,
    void* outputBuffer,
    unsigned long framesPerBuffer,
    const PaStreamCallbackTimeInfo* timeInfo,
    PaStreamCallbackFlags statusFlags,
    void* userData
) {
    AsioStream* self = static_cast<AsioStream*>(userData);

    self->callbackCount_++;

    if (statusFlags & paInputUnderflow) {
        self->inputUnderflows_++;
    }
    if (statusFlags & paOutputUnderflow) {
        self->outputUnderflows_++;
    }

    // Handle output from write buffer
    if (outputBuffer && self->outputChannels_ > 0) {
        float* out = static_cast<float*>(outputBuffer);
        size_t samplesToWrite = framesPerBuffer * self->outputChannels_;

        std::lock_guard<std::mutex> lock(self->writeMutex_);
        size_t available = self->writePos_;

        if (available >= samplesToWrite) {
            std::memcpy(out, self->writeBuffer_.data(), samplesToWrite * sizeof(float));
            // Shift remaining data
            if (available > samplesToWrite) {
                std::memmove(self->writeBuffer_.data(),
                            self->writeBuffer_.data() + samplesToWrite,
                            (available - samplesToWrite) * sizeof(float));
            }
            self->writePos_ -= samplesToWrite;
        } else {
            // Not enough data, output silence
            std::memset(out, 0, samplesToWrite * sizeof(float));
        }
    }

    // Send input to JavaScript callback
    if (inputBuffer && self->hasCallback_ && self->tsfn_) {
        const float* in = static_cast<const float*>(inputBuffer);
        size_t sampleCount = framesPerBuffer * self->inputChannels_;

        // Copy input data
        float* dataCopy = new float[sampleCount];
        std::memcpy(dataCopy, in, sampleCount * sizeof(float));

        // Create callback data
        struct CallbackData {
            float* data;
            size_t size;
            int channels;
        };

        CallbackData* cbData = new CallbackData{dataCopy, sampleCount, self->inputChannels_};

        self->tsfn_.NonBlockingCall(cbData, [](Napi::Env env, Napi::Function jsCallback, CallbackData* data) {
            // Create input buffer arrays
            Napi::Array inputBuffers = Napi::Array::New(env, data->channels);
            size_t framesPerChannel = data->size / data->channels;

            for (int ch = 0; ch < data->channels; ch++) {
                Napi::Float32Array channelData = Napi::Float32Array::New(env, framesPerChannel);
                for (size_t i = 0; i < framesPerChannel; i++) {
                    channelData[i] = data->data[i * data->channels + ch];
                }
                inputBuffers.Set(ch, channelData);
            }

            // Output buffers (empty for now)
            Napi::Array outputBuffers = Napi::Array::New(env, 0);

            jsCallback.Call({inputBuffers, outputBuffers});

            delete[] data->data;
            delete data;
        });
    }

    return paContinue;
}

Napi::Value AsioStream::Start(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!stream_ || isClosed_) {
        return Napi::Boolean::New(env, false);
    }

    if (isRunning_) {
        return Napi::Boolean::New(env, true);
    }

    PaError err = Pa_StartStream(stream_);
    if (err != paNoError) {
        return Napi::Boolean::New(env, false);
    }

    isRunning_ = true;
    return Napi::Boolean::New(env, true);
}

Napi::Value AsioStream::Stop(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!stream_ || isClosed_ || !isRunning_) {
        return Napi::Boolean::New(env, true);
    }

    PaError err = Pa_StopStream(stream_);
    isRunning_ = false;

    return Napi::Boolean::New(env, err == paNoError);
}

Napi::Value AsioStream::Close(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (isClosed_) {
        return env.Undefined();
    }

    if (isRunning_) {
        Pa_StopStream(stream_);
        isRunning_ = false;
    }

    if (stream_) {
        Pa_CloseStream(stream_);
        stream_ = nullptr;
    }

    if (hasCallback_ && tsfn_) {
        tsfn_.Release();
        hasCallback_ = false;
    }

    isClosed_ = true;
    return env.Undefined();
}

Napi::Value AsioStream::SetProcessCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function expected").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Release existing callback
    if (hasCallback_ && tsfn_) {
        tsfn_.Release();
    }

    Napi::Function callback = info[0].As<Napi::Function>();
    tsfn_ = Napi::ThreadSafeFunction::New(
        env,
        callback,
        "AsioCallback",
        0,  // Max queue size (0 = unlimited)
        1   // Initial thread count
    );

    hasCallback_ = true;
    return env.Undefined();
}

Napi::Value AsioStream::Write(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsArray()) {
        return Napi::Number::New(env, 0);
    }

    Napi::Array buffers = info[0].As<Napi::Array>();
    if (buffers.Length() == 0) {
        return Napi::Number::New(env, 0);
    }

    // Get first channel to determine frame count
    Napi::Float32Array firstChannel = buffers.Get(0u).As<Napi::Float32Array>();
    size_t frameCount = firstChannel.ElementLength();
    size_t channelCount = buffers.Length();

    // Interleave data
    std::vector<float> interleaved(frameCount * channelCount);
    for (size_t ch = 0; ch < channelCount; ch++) {
        Napi::Float32Array channelData = buffers.Get(ch).As<Napi::Float32Array>();
        for (size_t i = 0; i < frameCount && i < channelData.ElementLength(); i++) {
            interleaved[i * channelCount + ch] = channelData[i];
        }
    }

    // Add to write buffer
    std::lock_guard<std::mutex> lock(writeMutex_);
    size_t spaceAvailable = writeBuffer_.size() - writePos_;
    size_t samplesToWrite = std::min(interleaved.size(), spaceAvailable);

    if (samplesToWrite > 0) {
        std::memcpy(writeBuffer_.data() + writePos_, interleaved.data(), samplesToWrite * sizeof(float));
        writePos_ += samplesToWrite;
    }

    return Napi::Number::New(env, static_cast<double>(samplesToWrite / channelCount));
}

Napi::Value AsioStream::GetIsRunning(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), isRunning_.load());
}

Napi::Value AsioStream::GetInputLatency(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!stream_) return Napi::Number::New(env, 0);

    const PaStreamInfo* streamInfo = Pa_GetStreamInfo(stream_);
    return Napi::Number::New(env, streamInfo ? streamInfo->inputLatency * 1000 : 0);
}

Napi::Value AsioStream::GetOutputLatency(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!stream_) return Napi::Number::New(env, 0);

    const PaStreamInfo* streamInfo = Pa_GetStreamInfo(stream_);
    return Napi::Number::New(env, streamInfo ? streamInfo->outputLatency * 1000 : 0);
}

Napi::Value AsioStream::GetSampleRate(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), sampleRate_);
}

Napi::Value AsioStream::GetBufferSize(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), static_cast<double>(bufferSize_));
}

Napi::Value AsioStream::GetInputChannelCount(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), inputChannels_);
}

Napi::Value AsioStream::GetOutputChannelCount(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), outputChannels_);
}

Napi::Value AsioStream::GetStats(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object stats = Napi::Object::New(env);

    stats.Set("callbackCount", Napi::Number::New(env, static_cast<double>(callbackCount_.load())));
    stats.Set("inputUnderflows", Napi::Number::New(env, inputUnderflows_.load()));
    stats.Set("outputUnderflows", Napi::Number::New(env, outputUnderflows_.load()));

    // CPU load
    double cpuLoad = 0;
    if (stream_) {
        cpuLoad = Pa_GetStreamCpuLoad(stream_);
    }
    stats.Set("cpuLoad", Napi::Number::New(env, cpuLoad));

    return stats;
}
