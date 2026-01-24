/**
 * AsioStream - PortAudio ASIO stream wrapper for Node.js
 */

#ifndef ASIO_WRAPPER_H
#define ASIO_WRAPPER_H

#include <napi.h>
#include <portaudio.h>
#include <vector>
#include <atomic>
#include <mutex>

class AsioStream : public Napi::ObjectWrap<AsioStream> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    AsioStream(const Napi::CallbackInfo& info);
    ~AsioStream();

private:
    static Napi::FunctionReference constructor;

    // Stream control
    Napi::Value Start(const Napi::CallbackInfo& info);
    Napi::Value Stop(const Napi::CallbackInfo& info);
    Napi::Value Close(const Napi::CallbackInfo& info);

    // Callback
    Napi::Value SetProcessCallback(const Napi::CallbackInfo& info);
    Napi::Value Write(const Napi::CallbackInfo& info);

    // Properties
    Napi::Value GetIsRunning(const Napi::CallbackInfo& info);
    Napi::Value GetInputLatency(const Napi::CallbackInfo& info);
    Napi::Value GetOutputLatency(const Napi::CallbackInfo& info);
    Napi::Value GetSampleRate(const Napi::CallbackInfo& info);
    Napi::Value GetBufferSize(const Napi::CallbackInfo& info);
    Napi::Value GetInputChannelCount(const Napi::CallbackInfo& info);
    Napi::Value GetOutputChannelCount(const Napi::CallbackInfo& info);
    Napi::Value GetStats(const Napi::CallbackInfo& info);

    // PortAudio callback
    static int PaCallback(
        const void* inputBuffer,
        void* outputBuffer,
        unsigned long framesPerBuffer,
        const PaStreamCallbackTimeInfo* timeInfo,
        PaStreamCallbackFlags statusFlags,
        void* userData
    );

    // Stream state
    PaStream* stream_;
    PaDeviceIndex deviceIndex_;
    double sampleRate_;
    unsigned long bufferSize_;
    int inputChannels_;
    int outputChannels_;
    std::atomic<bool> isRunning_;
    std::atomic<bool> isClosed_;

    // Callback handling
    Napi::ThreadSafeFunction tsfn_;
    bool hasCallback_;

    // Stats
    std::atomic<uint64_t> callbackCount_;
    std::atomic<uint32_t> inputUnderflows_;
    std::atomic<uint32_t> outputUnderflows_;

    // Write buffer for async output
    std::mutex writeMutex_;
    std::vector<float> writeBuffer_;
    size_t writePos_;
};

#endif // ASIO_WRAPPER_H
