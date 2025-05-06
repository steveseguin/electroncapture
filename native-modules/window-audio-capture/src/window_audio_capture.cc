// window_audio_capture.cc
#include <napi.h>
#include <windows.h>
#include <mmdeviceapi.h>
#include <audiopolicy.h>
#include <audioclient.h>
#include <endpointvolume.h>
#include <functiondiscoverykeys_devpkey.h>
#include <Psapi.h>
#include <vector>
#include <string>
#include <iostream>
#include <mutex>
#include <memory>
#include <audioclientactivationparams.h>
#include <tlhelp32.h>
#include <algorithm>
#include <cmath>
#include <iostream>
// COM smart pointer typedefs
#include <combaseapi.h>
#include <wrl/client.h>
// Add wrl/implements.h for RuntimeClass
#include <wrl/implements.h>

#ifndef AUDCLNT_E_PROCESS_LOOPBACK_ALREADY_EXISTS
#define AUDCLNT_E_PROCESS_LOOPBACK_ALREADY_EXISTS  MAKE_HRESULT(SEVERITY_ERROR, FACILITY_AUDCLNT, 0x02C)
#endif

#ifndef AUDCLNT_E_ENDPOINT_CREATION_FAILED
#define AUDCLNT_E_ENDPOINT_CREATION_FAILED  MAKE_HRESULT(SEVERITY_ERROR, FACILITY_AUDCLNT, 0x24)
#endif

using Microsoft::WRL::ComPtr;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;
using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::Make;

// Forward declarations
struct WindowInfoStruct {
  HWND hwnd;
  std::wstring title;
  DWORD processId;
  std::wstring executableName;
};

// Audio data structure for callback
struct AudioDataChunk {
  std::vector<float> samples;
  uint32_t sampleRate;
  uint32_t channels;
};

DWORD WINAPI ProcessSpecificCaptureThreadProc(LPVOID lpParameter);

// Global audio buffer, visible to the capture thread
static std::vector<float> audioBuffer;
static std::mutex audioBufferMutex;
static const size_t MAX_BUFFER_SIZE = 1024 * 1024; // Limit buffer size

// Audio streaming callback function type
typedef Napi::ThreadSafeFunction AudioStreamCallback;

// Add these method declarations to the private section in the WindowAudioCapture class definition
class WindowAudioCapture : public Napi::ObjectWrap<WindowAudioCapture> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  WindowAudioCapture(const Napi::CallbackInfo& info);
  ~WindowAudioCapture();

  // Public members for thread access
  ComPtr<IAudioCaptureClient> captureClient;
  ComPtr<IAudioClient> audioClient;
  WAVEFORMATEX* pwfx = nullptr;
  HANDLE stopEvent = NULL;
  AudioStreamCallback tsfn; // Thread-safe function for streaming audio
  bool useStreamCallback = false;
  ComPtr<IAudioSessionControl2> targetSessionControl;
  DWORD targetProcessId = 0; // Moved to public for thread access

private:
  static Napi::FunctionReference constructor;
  
  // Wrapped native methods
  Napi::Value GetWindowList(const Napi::CallbackInfo& info);
  Napi::Value GetAudioSessions(const Napi::CallbackInfo& info); // Add this declaration
  Napi::Value StartCapture(const Napi::CallbackInfo& info);
  Napi::Value StartStreamCapture(const Napi::CallbackInfo& info);
  Napi::Value StopCapture(const Napi::CallbackInfo& info);
  Napi::Value GetAudioData(const Napi::CallbackInfo& info);
  
  std::vector<WindowInfoStruct> EnumerateWindows();
  bool CreateProcessSpecificLoopbackCapture(DWORD processId);
  
  // Audio capture state
  ComPtr<IMMDeviceEnumerator> deviceEnumerator;
  ComPtr<IMMDevice> captureDevice;
  bool isCapturing = false;
  HANDLE captureThread = NULL;
  
  // Audio capture method flags
  bool usingProcessSpecificLoopback = false;
};

Napi::Value WindowAudioCapture::GetAudioSessions(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::HandleScope scope(env);
  
  // Get the default render endpoint device
  ComPtr<IMMDevice> device;
  HRESULT hr = deviceEnumerator->GetDefaultAudioEndpoint(eRender, eConsole, device.GetAddressOf());
  if (FAILED(hr)) {
    Napi::Error::New(env, "Failed to get default audio endpoint").ThrowAsJavaScriptException();
    return env.Null();
  }
  
  // Get session manager
  ComPtr<IAudioSessionManager2> sessionManager;
  hr = device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, NULL, (void**)sessionManager.GetAddressOf());
  if (FAILED(hr)) {
    Napi::Error::New(env, "Failed to get session manager").ThrowAsJavaScriptException();
    return env.Null();
  }
  
  // Get session enumerator
  ComPtr<IAudioSessionEnumerator> sessionEnumerator;
  hr = sessionManager->GetSessionEnumerator(sessionEnumerator.GetAddressOf());
  if (FAILED(hr)) {
    Napi::Error::New(env, "Failed to get session enumerator").ThrowAsJavaScriptException();
    return env.Null();
  }
  
  // Count sessions
  int sessionCount;
  hr = sessionEnumerator->GetCount(&sessionCount);
  if (FAILED(hr)) {
    Napi::Error::New(env, "Failed to get session count").ThrowAsJavaScriptException();
    return env.Null();
  }
  
  // Create result array
  Napi::Array result = Napi::Array::New(env);
  
  // Enumerate all sessions
  int validSessionCount = 0;
  for (int i = 0; i < sessionCount; i++) {
    ComPtr<IAudioSessionControl> control;
    hr = sessionEnumerator->GetSession(i, control.GetAddressOf());
    if (FAILED(hr)) continue;
    
    ComPtr<IAudioSessionControl2> control2;
    hr = control.As(&control2);
    if (FAILED(hr)) continue;
    
    // Get session info
    DWORD processId;
    hr = control2->GetProcessId(&processId);
    
    if (SUCCEEDED(hr) && processId != 0) {  // Skip system mixer (PID 0)
      // Get process info
      HANDLE hProcess = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, processId);
      if (!hProcess) continue;
      
      // Get executable path
      WCHAR processPath[MAX_PATH] = {0};
      DWORD pathLen = GetModuleFileNameExW(hProcess, NULL, processPath, MAX_PATH);
      CloseHandle(hProcess);
      
      if (pathLen == 0) continue;
      
      // Get display name for the session
      LPWSTR displayName = nullptr;
      hr = control->GetDisplayName(&displayName);
      
      // Get session state
      AudioSessionState state;
      control->GetState(&state);
      
      // Convert to UTF-8
      std::string utf8Path;
      if (pathLen > 0) {
        int utf8Size = WideCharToMultiByte(CP_UTF8, 0, processPath, -1, NULL, 0, NULL, NULL);
        utf8Path.resize(utf8Size);
        WideCharToMultiByte(CP_UTF8, 0, processPath, -1, &utf8Path[0], utf8Size, NULL, NULL);
        utf8Path.pop_back();  // Remove null terminator
      }
      
      std::string utf8DisplayName;
      if (displayName) {
        int utf8Size = WideCharToMultiByte(CP_UTF8, 0, displayName, -1, NULL, 0, NULL, NULL);
        utf8DisplayName.resize(utf8Size);
        WideCharToMultiByte(CP_UTF8, 0, displayName, -1, &utf8DisplayName[0], utf8Size, NULL, NULL);
        utf8DisplayName.pop_back();  // Remove null terminator
        CoTaskMemFree(displayName);
      }
      
      // Extract executable name
      std::string exeName = utf8Path;
      size_t lastSlash = utf8Path.find_last_of('\\');
      if (lastSlash != std::string::npos) {
        exeName = utf8Path.substr(lastSlash + 1);
      }
      
      // Create session object
      Napi::Object session = Napi::Object::New(env);
      session.Set("id", Napi::Number::New(env, validSessionCount)); // Use our own counter as ID
      session.Set("sessionId", Napi::Number::New(env, i));  // Store actual session index
      session.Set("processId", Napi::Number::New(env, processId));
      session.Set("executablePath", Napi::String::New(env, utf8Path));
      session.Set("executableName", Napi::String::New(env, exeName));
      session.Set("displayName", Napi::String::New(env, utf8DisplayName));
      session.Set("state", Napi::Number::New(env, state));
      session.Set("isActive", Napi::Boolean::New(env, state == AudioSessionStateActive));
      
      result[validSessionCount++] = session;
    }
  }
  
  return result;
}

// Helper to get process executable name
std::wstring GetProcessExecutableName(DWORD processId) {
  std::wstring result;
  HANDLE hProcess = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, processId);
  
  if (hProcess) {
    WCHAR path[MAX_PATH] = {0};
    if (GetModuleFileNameExW(hProcess, NULL, path, MAX_PATH)) {
      // Extract just the executable name from the path
      wchar_t* fileName = wcsrchr(path, L'\\');
      if (fileName) {
        result = fileName + 1; // Skip the backslash
      } else {
        result = path;
      }
    }
    CloseHandle(hProcess);
  }
  
  return result;
}

bool WindowAudioCapture::CreateProcessSpecificLoopbackCapture(DWORD processId) {
  targetProcessId = processId;
  
  // Create activation params for process-specific loopback
  AUDIOCLIENT_ACTIVATION_PARAMS activationParams = {};
  activationParams.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  activationParams.ProcessLoopbackParams.TargetProcessId = processId;
  activationParams.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
  
  PROPVARIANT activationPropVarParams = {};
  activationPropVarParams.vt = VT_BLOB;
  activationPropVarParams.blob.cbSize = sizeof(activationParams);
  activationPropVarParams.blob.pBlobData = reinterpret_cast<BYTE*>(&activationParams);
  
  // Define the AudioActivationHandler class inside the function scope to avoid global namespace pollution
  class AudioActivationHandler : public Microsoft::WRL::RuntimeClass<
      Microsoft::WRL::RuntimeClassFlags<Microsoft::WRL::ClassicCom>,
      IActivateAudioInterfaceCompletionHandler> {
  public:
    HANDLE activationCompleted = CreateEvent(nullptr, FALSE, FALSE, nullptr);
    HRESULT activationResult = E_FAIL;
    ComPtr<IAudioClient> audioClient;
    
    STDMETHOD(ActivateCompleted)(IActivateAudioInterfaceAsyncOperation* operation) {
      operation->GetActivateResult(&activationResult, &audioClient);
      SetEvent(activationCompleted);
      return S_OK;
    }
    
    ~AudioActivationHandler() {
      CloseHandle(activationCompleted);
    }
  };
  
  ComPtr<AudioActivationHandler> handler = Microsoft::WRL::Make<AudioActivationHandler>();
  ComPtr<IActivateAudioInterfaceAsyncOperation> asyncOp;
  
  // Output debugging information
  std::cerr << "Attempting process-specific loopback for PID: " << processId << std::endl;
  
  // Get process name for better error reporting
  std::wstring processName = GetProcessExecutableName(processId);
  char processNameA[MAX_PATH] = {0};
  WideCharToMultiByte(CP_UTF8, 0, processName.c_str(), -1, processNameA, MAX_PATH, NULL, NULL);
  std::cerr << "Target process: " << processNameA << " (PID: " << processId << ")" << std::endl;
  
  // Check if process is running with admin rights
  bool isElevated = false;
  HANDLE hToken = NULL;
  if (OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &hToken)) {
    TOKEN_ELEVATION elevation;
    DWORD cbSize = sizeof(TOKEN_ELEVATION);
    if (GetTokenInformation(hToken, TokenElevation, &elevation, sizeof(elevation), &cbSize)) {
      isElevated = elevation.TokenIsElevated;
    }
    CloseHandle(hToken);
  }
  
  std::cerr << "Current process running with admin rights: " << (isElevated ? "Yes" : "No") << std::endl;
  if (!isElevated) {
    std::cerr << "WARNING: Process-specific loopback typically requires admin privileges" << std::endl;
  }
  
  // Check Windows version for compatibility
  OSVERSIONINFOEX osvi = { 0 };
  osvi.dwOSVersionInfoSize = sizeof(OSVERSIONINFOEX);
  typedef LONG (WINAPI* RtlGetVersionPtr)(PRTL_OSVERSIONINFOW);
  HMODULE hMod = GetModuleHandle(TEXT("ntdll.dll"));
  if (hMod) {
    RtlGetVersionPtr RtlGetVersion = (RtlGetVersionPtr)GetProcAddress(hMod, "RtlGetVersion");
    if (RtlGetVersion) {
      RtlGetVersion((PRTL_OSVERSIONINFOW)&osvi);
    }
  }
  
  // Windows 10 1803 is version 10.0.17134
  bool isCompatibleWindows = (osvi.dwMajorVersion > 10) || 
    (osvi.dwMajorVersion == 10 && osvi.dwBuildNumber >= 17134);
  
  std::cerr << "Windows version: " << osvi.dwMajorVersion << "." << osvi.dwMinorVersion 
    << " Build " << osvi.dwBuildNumber << std::endl;
  std::cerr << "Is compatible Windows version: " << (isCompatibleWindows ? "Yes" : "No") << std::endl;
  
  if (!isCompatibleWindows) {
    std::cerr << "ERROR: Process-specific loopback requires Windows 10 version 1803 or newer" << std::endl;
    return false; // Don't even try to do process-specific loopback
  }
  
  // Activate the audio client with process-specific params
  HRESULT hr = ActivateAudioInterfaceAsync(
    VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, 
    __uuidof(IAudioClient), 
    &activationPropVarParams,
    handler.Get(),
    asyncOp.GetAddressOf()
  );
  
  if (FAILED(hr)) {
    std::cerr << "ERROR: Failed to start process-specific audio activation: 0x" << std::hex << hr << std::dec << std::endl;
    
    // Provide specific error messages for common failure cases
    switch (hr) {
      case E_ACCESSDENIED:
        std::cerr << "ERROR CODE E_ACCESSDENIED: Access denied - Application must run with admin privileges" << std::endl;
        break;
      case E_INVALIDARG:
        std::cerr << "ERROR CODE E_INVALIDARG: Invalid arguments provided to audio activation" << std::endl;
        break;
      case E_OUTOFMEMORY:
        std::cerr << "ERROR CODE E_OUTOFMEMORY: Out of memory during audio activation" << std::endl;
        break;
      case REGDB_E_CLASSNOTREG:
        std::cerr << "ERROR CODE REGDB_E_CLASSNOTREG: Required audio interface not registered (Windows version issue)" << std::endl;
        break;
      default:
        std::cerr << "ERROR: Unknown error starting audio activation" << std::endl;
    }
    
    return false; // Don't fall back to standard loopback
  }
  
  // Wait for activation to complete with timeout
  DWORD waitResult = WaitForSingleObject(handler->activationCompleted, 5000); // 5 second timeout
  if (waitResult != WAIT_OBJECT_0) {
    std::cerr << "ERROR: Timeout waiting for audio activation, status: " << waitResult << std::endl;
    if (waitResult == WAIT_TIMEOUT) {
      std::cerr << "Timed out after 5 seconds - this may indicate a system resource issue" << std::endl;
    }
    return false; // Don't fall back to standard loopback
  }
  
  if (FAILED(handler->activationResult)) {
    std::cerr << "ERROR: Process-specific activation failed: 0x" << std::hex << handler->activationResult << std::dec << std::endl;
    
    // Provide more detailed error messages
    switch (handler->activationResult) {
      case AUDCLNT_E_PROCESS_LOOPBACK_ALREADY_EXISTS:
        std::cerr << "ERROR CODE AUDCLNT_E_PROCESS_LOOPBACK_ALREADY_EXISTS: Another application is already capturing audio from this process" << std::endl;
        std::cerr << "Check for other applications that might be capturing audio from this process" << std::endl;
        break;
      case AUDCLNT_E_ENDPOINT_CREATION_FAILED:
        std::cerr << "ERROR CODE AUDCLNT_E_ENDPOINT_CREATION_FAILED: Failed to create audio endpoint" << std::endl;
        std::cerr << "This may be due to the target process not having an active audio session" << std::endl;
        break;
      case E_ACCESSDENIED:
        std::cerr << "ERROR CODE E_ACCESSDENIED: Access denied during audio activation" << std::endl;
        std::cerr << "Make sure the application is running with administrator privileges" << std::endl;
        break;
      default:
        std::cerr << "Unknown audio activation error - check if the target process is producing audio" << std::endl;
    }
    
    return false; // Don't fall back to standard loopback
  }
  
  // Get the activated client
  audioClient = handler->audioClient;
  if (!audioClient) {
    std::cerr << "ERROR: Null audio client returned, activation may have silently failed" << std::endl;
    std::cerr << "This is often due to the target application not currently playing audio" << std::endl;
    return false; // Don't fall back to standard loopback
  }
  
  std::cerr << "Successfully created process-specific loopback for PID: " << processId << std::endl;
  
  // Get mix format
  hr = audioClient->GetMixFormat(&pwfx);
  if (FAILED(hr)) {
    std::cerr << "ERROR: Failed to get mix format: 0x" << std::hex << hr << std::dec << std::endl;
    return false; // Don't fall back to standard loopback
  }
  
  // Log the audio format
  std::cerr << "Audio format details:" << std::endl;
  std::cerr << "  Format Tag: " << pwfx->wFormatTag << std::endl;
  std::cerr << "  Channels: " << pwfx->nChannels << std::endl;
  std::cerr << "  Sample Rate: " << pwfx->nSamplesPerSec << std::endl;
  std::cerr << "  Bits Per Sample: " << pwfx->wBitsPerSample << std::endl;
  std::cerr << "  Block Align: " << pwfx->nBlockAlign << std::endl;
  std::cerr << "  Avg Bytes Per Sec: " << pwfx->nAvgBytesPerSec << std::endl;
  
  // Check extended format details
  if (pwfx->wFormatTag == WAVE_FORMAT_EXTENSIBLE && pwfx->cbSize >= 22) {
    WAVEFORMATEXTENSIBLE* pwfxExt = reinterpret_cast<WAVEFORMATEXTENSIBLE*>(pwfx);
    std::cerr << "  Format is EXTENSIBLE:" << std::endl;
    std::cerr << "    Valid Bits Per Sample: " << pwfxExt->Samples.wValidBitsPerSample << std::endl;
    std::cerr << "    Channel Mask: 0x" << std::hex << pwfxExt->dwChannelMask << std::dec << std::endl;
    
    GUID subFormat = pwfxExt->SubFormat;
    char guidStr[64];
    sprintf_s(guidStr, "{%08lX-%04hX-%04hX-%02hhX%02hhX-%02hhX%02hhX%02hhX%02hhX%02hhX%02hhX}",
              subFormat.Data1, subFormat.Data2, subFormat.Data3,
              subFormat.Data4[0], subFormat.Data4[1], subFormat.Data4[2], subFormat.Data4[3],
              subFormat.Data4[4], subFormat.Data4[5], subFormat.Data4[6], subFormat.Data4[7]);
    std::cerr << "    SubFormat: " << guidStr << std::endl;
    
    if (subFormat == KSDATAFORMAT_SUBTYPE_PCM) {
      std::cerr << "    SubFormat is PCM" << std::endl;
    } else if (subFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT) {
      std::cerr << "    SubFormat is IEEE Float" << std::endl;
    }
  }
  
  // Initialize the audio client - for process specific capture
  // IMPORTANT: Don't use AUDCLNT_STREAMFLAGS_LOOPBACK for process-specific capture
  hr = audioClient->Initialize(
    AUDCLNT_SHAREMODE_SHARED,  // Shared mode
    0,                         // No flags for process-specific capture
    0,                        // Default buffer duration (100ns units)
    0,                        // Periodicity (for exclusive mode)
    pwfx,                     // Format
    NULL                      // Session GUID (nullptr for default)
  );
  
  if (FAILED(hr)) {
    std::cerr << "ERROR: Failed to initialize audio client: 0x" << std::hex << hr << std::dec << std::endl;
    switch (hr) {
      case AUDCLNT_E_DEVICE_IN_USE:
        std::cerr << "ERROR CODE AUDCLNT_E_DEVICE_IN_USE: Audio device is already in use in exclusive mode" << std::endl;
        break;
      case AUDCLNT_E_UNSUPPORTED_FORMAT:
        std::cerr << "ERROR CODE AUDCLNT_E_UNSUPPORTED_FORMAT: The audio format is not supported" << std::endl;
        break;
      case E_OUTOFMEMORY:
        std::cerr << "ERROR CODE E_OUTOFMEMORY: Out of memory during audio client initialization" << std::endl;
        break;
      default:
        std::cerr << "Unknown error initializing audio client" << std::endl;
    }
    return false; // Don't fall back to standard loopback
  }
  
  // Get the capture client
  hr = audioClient->GetService(__uuidof(IAudioCaptureClient), (void**)captureClient.GetAddressOf());
  if (FAILED(hr)) {
    std::cerr << "ERROR: Failed to get capture client: 0x" << std::hex << hr << std::dec << std::endl;
    return false; // Don't fall back to standard loopback
  }
  
  // No need for session control with process-specific loopback
  targetSessionControl = nullptr;
  usingProcessSpecificLoopback = true;
  
  return true;
}

DWORD WINAPI ProcessSpecificCaptureThreadProc(LPVOID lpParameter) {
  WindowAudioCapture* capture = static_cast<WindowAudioCapture*>(lpParameter);
  IAudioCaptureClient* captureClient = capture->captureClient.Get();
  WAVEFORMATEX* pwfx = capture->pwfx;
  HANDLE stopEvent = capture->stopEvent;
  
  std::cerr << "Starting audio capture for process ID: " << capture->targetProcessId << std::endl;
  
  // Flag to indicate if we have a specific session to monitor
  bool haveSessionControl = capture->targetSessionControl != nullptr;
  IAudioSessionControl2* sessionControl = capture->targetSessionControl.Get();
  
  // Variables to track session state
  AudioSessionState sessionState = AudioSessionStateInactive;
  if (haveSessionControl) {
    sessionControl->GetState(&sessionState);
    std::cerr << "Initial session state: " << sessionState << std::endl;
  }
  
  UINT32 packetLength = 0;
  BYTE* data;
  UINT32 numFramesAvailable;
  DWORD flags;
  UINT64 devicePosition;
  UINT64 qpcPosition;
  
  // Start the audio client
  HRESULT hr = capture->audioClient->Start();
  if (FAILED(hr)) {
    std::cerr << "Failed to start audio client: " << hr << std::endl;
    return 1;
  }
  
  // Size of chunks to send in each callback
  const UINT32 CHUNK_SIZE = 1024; // Frames per callback
  std::vector<float> chunkBuffer;
  
  // For audio level monitoring
  float peakLevel = 0.0f;
  DWORD lastPeakReset = GetTickCount();
  
  // Print the actual format being used
  std::cerr << "Starting capture with format:" << std::endl;
  std::cerr << "  Format Tag: " << pwfx->wFormatTag << std::endl;
  std::cerr << "  Channels: " << pwfx->nChannels << std::endl;
  std::cerr << "  Sample Rate: " << pwfx->nSamplesPerSec << std::endl;
  std::cerr << "  Bits Per Sample: " << pwfx->wBitsPerSample << std::endl;
  
  // Check if format is EXTENSIBLE to get SubFormat details
  if (pwfx->wFormatTag == WAVE_FORMAT_EXTENSIBLE && pwfx->cbSize >= 22) {
    WAVEFORMATEXTENSIBLE* pwfxExt = reinterpret_cast<WAVEFORMATEXTENSIBLE*>(pwfx);
    GUID subFormat = pwfxExt->SubFormat;
    std::cerr << "  SubFormat GUID: {" << std::hex 
              << subFormat.Data1 << "-" << subFormat.Data2 << "-" << subFormat.Data3 << "}" << std::dec << std::endl;
    
    // Check common SubFormats
    if (subFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT) {
      std::cerr << "  SubFormat is IEEE Float" << std::endl;
    } else if (subFormat == KSDATAFORMAT_SUBTYPE_PCM) {
      std::cerr << "  SubFormat is PCM" << std::endl;
    }
  }
  
  while (WaitForSingleObject(stopEvent, 0) != WAIT_OBJECT_0) {
    // Check if session is still active (check every 100ms)
    static DWORD lastStateCheck = 0;
    DWORD now = GetTickCount();
    
    if (haveSessionControl && (now - lastStateCheck > 100)) {
      lastStateCheck = now;
      AudioSessionState newState;
      hr = sessionControl->GetState(&newState);
      if (SUCCEEDED(hr) && newState != sessionState) {
        sessionState = newState;
        std::cerr << "Session state changed to: " << 
          (sessionState == AudioSessionStateActive ? "Active" :
           sessionState == AudioSessionStateInactive ? "Inactive" : "Expired") 
          << std::endl;
      }
    }
    
    // Get the next packet of data
    hr = captureClient->GetNextPacketSize(&packetLength);
    if (FAILED(hr)) {
      std::cerr << "Failed to get next packet size: " << hr << std::endl;
      break;
    }
    
    while (packetLength > 0) {
      // Get the audio data
      hr = captureClient->GetBuffer(
        &data,
        &numFramesAvailable,
        &flags,
        &devicePosition,
        &qpcPosition
      );
      
      if (FAILED(hr)) {
        std::cerr << "Failed to get buffer: " << hr << std::endl;
        break;
      }
      
      // Process the audio data if there's something to process
      // and either we have no session control or the session is active
      bool shouldProcess = numFramesAvailable > 0 && 
                    !(flags & AUDCLNT_BUFFERFLAGS_SILENT) &&
                    (!haveSessionControl || 
                     sessionState == AudioSessionStateActive || 
                     sessionState == AudioSessionStateInactive);
      
      if (shouldProcess) {
        // Clear the chunk buffer
        chunkBuffer.clear();
        chunkBuffer.reserve(numFramesAvailable * pwfx->nChannels); // Pre-allocate space

        // Identify the format and process accordingly
        bool formatHandled = false;

        // Handle EXTENSIBLE format
        if (pwfx->wFormatTag == WAVE_FORMAT_EXTENSIBLE && pwfx->cbSize >= 22) {
          WAVEFORMATEXTENSIBLE* pwfxExt = reinterpret_cast<WAVEFORMATEXTENSIBLE*>(pwfx);
          
          // IEEE float format
          if (pwfxExt->SubFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT) {
            float* floatData = reinterpret_cast<float*>(data);
            for (UINT32 i = 0; i < numFramesAvailable * pwfx->nChannels; i++) {
              float sample = floatData[i];
              
              // Gentle soft limiting to prevent distortion
              if (sample > 1.0f) sample = 1.0f;
              else if (sample < -1.0f) sample = -1.0f;
              
              // Track peak level
              if (fabs(sample) > peakLevel) 
                peakLevel = fabs(sample);
                
              chunkBuffer.push_back(sample);
            }
            formatHandled = true;
          }
          // PCM format
          else if (pwfxExt->SubFormat == KSDATAFORMAT_SUBTYPE_PCM) {
            if (pwfx->wBitsPerSample == 16) {
              int16_t* pcmData = reinterpret_cast<int16_t*>(data);
              for (UINT32 i = 0; i < numFramesAvailable * pwfx->nChannels; i++) {
                float sample = static_cast<float>(pcmData[i]) / 32768.0f;
                if (fabs(sample) > peakLevel) 
                  peakLevel = fabs(sample);
                chunkBuffer.push_back(sample);
              }
              formatHandled = true;
            } 
            else if (pwfx->wBitsPerSample == 24) {
              // Handle 24-bit PCM (3 bytes per sample)
              uint8_t* byteData = reinterpret_cast<uint8_t*>(data);
              for (UINT32 i = 0; i < numFramesAvailable * pwfx->nChannels; i++) {
                int32_t sample24 = (byteData[i*3] << 8) | (byteData[i*3+1] << 16) | (byteData[i*3+2] << 24);
                float sample = static_cast<float>(sample24) / 2147483648.0f;
                if (fabs(sample) > peakLevel) 
                  peakLevel = fabs(sample);
                chunkBuffer.push_back(sample);
              }
              formatHandled = true;
            } 
            else if (pwfx->wBitsPerSample == 32) {
              int32_t* pcmData = reinterpret_cast<int32_t*>(data);
              for (UINT32 i = 0; i < numFramesAvailable * pwfx->nChannels; i++) {
                float sample = static_cast<float>(pcmData[i]) / 2147483648.0f;
                if (fabs(sample) > peakLevel) 
                  peakLevel = fabs(sample);
                chunkBuffer.push_back(sample);
              }
              formatHandled = true;
            }
          }
        }
        // Handle standard IEEE float format
        else if (pwfx->wFormatTag == WAVE_FORMAT_IEEE_FLOAT) {
          float* floatData = reinterpret_cast<float*>(data);
          for (UINT32 i = 0; i < numFramesAvailable * pwfx->nChannels; i++) {
            float sample = floatData[i];
            
            // Gentle soft limiting for values outside normalized range
            if (sample > 1.0f) sample = 1.0f;
            else if (sample < -1.0f) sample = -1.0f;
            
            if (fabs(sample) > peakLevel) 
              peakLevel = fabs(sample);
              
            chunkBuffer.push_back(sample);
          }
          formatHandled = true;
        }
        // Handle standard PCM format
        else if (pwfx->wFormatTag == WAVE_FORMAT_PCM) {
          if (pwfx->wBitsPerSample == 16) {
            int16_t* pcmData = reinterpret_cast<int16_t*>(data);
            for (UINT32 i = 0; i < numFramesAvailable * pwfx->nChannels; i++) {
              float sample = static_cast<float>(pcmData[i]) / 32768.0f;
              if (fabs(sample) > peakLevel) 
                peakLevel = fabs(sample);
              chunkBuffer.push_back(sample);
            }
            formatHandled = true;
          } 
          else if (pwfx->wBitsPerSample == 32) {
            int32_t* pcmData = reinterpret_cast<int32_t*>(data);
            for (UINT32 i = 0; i < numFramesAvailable * pwfx->nChannels; i++) {
              float sample = static_cast<float>(pcmData[i]) / 2147483648.0f;
              if (fabs(sample) > peakLevel) 
                peakLevel = fabs(sample);
              chunkBuffer.push_back(sample);
            }
            formatHandled = true;
          }
        }
        
        // If format wasn't handled, log the issue
        if (!formatHandled) {
          std::cerr << "Unsupported audio format - Tag: " << pwfx->wFormatTag 
                    << ", Bits: " << pwfx->wBitsPerSample << std::endl;
          
          // Still fill buffer with silence to maintain timing
          chunkBuffer.resize(numFramesAvailable * pwfx->nChannels, 0.0f);
        }

        // Periodically log audio levels
        if (now - lastPeakReset > 2000) {
          std::cerr << "Audio peak level: " << peakLevel << std::endl;
          peakLevel = 0.0f;
          lastPeakReset = now;
        }

        if (capture->useStreamCallback && !chunkBuffer.empty()) {
          AudioDataChunk* chunk = new AudioDataChunk{
            chunkBuffer,
            pwfx->nSamplesPerSec,
            pwfx->nChannels
          };
          
          capture->tsfn.NonBlockingCall(chunk, [](Napi::Env env, Napi::Function jsCallback, AudioDataChunk* data) {
            try {
              Napi::Float32Array samples = Napi::Float32Array::New(env, data->samples.size());
              for (size_t i = 0; i < data->samples.size(); i++) {
                samples[i] = data->samples[i];
              }
              
              Napi::Object result = Napi::Object::New(env);
              result.Set("samples", samples);
              result.Set("sampleRate", Napi::Number::New(env, data->sampleRate));
              result.Set("channels", Napi::Number::New(env, data->channels));
              
              jsCallback.Call({result});
            } catch (const std::exception& e) {
              std::cerr << "Exception in audio callback: " << e.what() << std::endl;
            }
            
            delete data;
          });
        }
        else {
          // Add to the global buffer if not in streaming mode
          std::lock_guard<std::mutex> lock(audioBufferMutex);
          
          // If buffer would exceed the max size, remove oldest samples
          if (audioBuffer.size() + chunkBuffer.size() > MAX_BUFFER_SIZE) {
			size_t samplesToRemove = (chunkBuffer.size() < audioBuffer.size()) ? chunkBuffer.size() : audioBuffer.size();
            audioBuffer.erase(audioBuffer.begin(), audioBuffer.begin() + samplesToRemove);
          }
          
          // Add the new samples
          audioBuffer.insert(audioBuffer.end(), chunkBuffer.begin(), chunkBuffer.end());
        }
      }
      
      // Release the buffer
      hr = captureClient->ReleaseBuffer(numFramesAvailable);
      if (FAILED(hr)) {
        std::cerr << "Failed to release buffer: " << hr << std::endl;
        break;
      }
      
      // Get the next packet size
      hr = captureClient->GetNextPacketSize(&packetLength);
      if (FAILED(hr)) {
        std::cerr << "Failed to get next packet size: " << hr << std::endl;
        break;
      }
    }
    
    // Sleep to reduce CPU usage
    Sleep(5);
  }
  
  // Stop the audio client
  capture->audioClient->Stop();
  std::cerr << "Audio capture thread exiting" << std::endl;
  
  // Release the thread-safe function if in streaming mode
  if (capture->useStreamCallback) {
    capture->tsfn.Release();
  }
  
  return 0;
}

Napi::Value WindowAudioCapture::StartCapture(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::HandleScope scope(env);
  
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "Window handle expected").ThrowAsJavaScriptException();
    return env.Null();
  }
  
  // Stop any existing capture
  if (isCapturing) {
    StopCapture(info);
  }
  
  // Get window handle from parameter
  HWND hwnd = reinterpret_cast<HWND>(info[0].As<Napi::Number>().Int64Value());
  
  // Get process ID for the window
  DWORD processId;
  GetWindowThreadProcessId(hwnd, &processId);
  
  if (processId == 0) {
    Napi::Error::New(env, "Failed to get process ID for window").ThrowAsJavaScriptException();
    return env.Null();
  }
  
  // Get process info for better error reporting
  std::wstring processName = GetProcessExecutableName(processId);
  std::string utf8ProcessName;
  if (!processName.empty()) {
    int utf8Size = WideCharToMultiByte(CP_UTF8, 0, processName.c_str(), -1, NULL, 0, NULL, NULL);
    utf8ProcessName.resize(utf8Size);
    WideCharToMultiByte(CP_UTF8, 0, processName.c_str(), -1, &utf8ProcessName[0], utf8Size, NULL, NULL);
    utf8ProcessName.pop_back();  // Remove null terminator
  } else {
    utf8ProcessName = "Unknown";
  }
  
  std::cerr << "Starting capture for window: " << utf8ProcessName << " (PID: " << processId << ")" << std::endl;
  
  // Set up process-specific capture - no fallback
  if (!CreateProcessSpecificLoopbackCapture(processId)) {
    // Create detailed error object
    Napi::Object errorObj = Napi::Object::New(env);
    errorObj.Set("success", Napi::Boolean::New(env, false));
    errorObj.Set("processId", Napi::Number::New(env, processId));
    errorObj.Set("processName", Napi::String::New(env, utf8ProcessName));
    errorObj.Set("error", Napi::String::New(env, "Process-specific loopback capture failed"));
    
    // Check if process has admin rights
    bool isElevated = false;
    HANDLE hToken = NULL;
    if (OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &hToken)) {
      TOKEN_ELEVATION elevation;
      DWORD cbSize = sizeof(TOKEN_ELEVATION);
      if (GetTokenInformation(hToken, TokenElevation, &elevation, sizeof(elevation), &cbSize)) {
        isElevated = elevation.TokenIsElevated;
      }
      CloseHandle(hToken);
    }
    errorObj.Set("hasAdminRights", Napi::Boolean::New(env, isElevated));
    
    // Check Windows version
    OSVERSIONINFOEX osvi = { 0 };
    osvi.dwOSVersionInfoSize = sizeof(OSVERSIONINFOEX);
    typedef LONG (WINAPI* RtlGetVersionPtr)(PRTL_OSVERSIONINFOW);
    HMODULE hMod = GetModuleHandle(TEXT("ntdll.dll"));
    if (hMod) {
      RtlGetVersionPtr RtlGetVersion = (RtlGetVersionPtr)GetProcAddress(hMod, "RtlGetVersion");
      if (RtlGetVersion) {
        RtlGetVersion((PRTL_OSVERSIONINFOW)&osvi);
      }
    }
    errorObj.Set("windowsVersion", Napi::String::New(env, 
      std::to_string(osvi.dwMajorVersion) + "." + 
      std::to_string(osvi.dwMinorVersion) + " (Build " + 
      std::to_string(osvi.dwBuildNumber) + ")"));
    
    // Check if compatible Windows version (Win10 1803+)
    bool isCompatibleWindows = (osvi.dwMajorVersion > 10) || 
      (osvi.dwMajorVersion == 10 && osvi.dwBuildNumber >= 17134);
    errorObj.Set("isCompatibleWindowsVersion", Napi::Boolean::New(env, isCompatibleWindows));
    
    // Return error object with diagnostic info
    return errorObj;
  }
  
  // Reset stop event
  ResetEvent(stopEvent);
  
  // Not using streaming mode
  useStreamCallback = false;
  
  // Start capture thread
  captureThread = CreateThread(NULL, 0, ProcessSpecificCaptureThreadProc, this, 0, NULL);
  if (captureThread == NULL) {
    audioClient->Stop();
    Napi::Error::New(env, "Failed to create capture thread").ThrowAsJavaScriptException();
    return env.Null();
  }
  
  isCapturing = true;
  
  // Return a detailed success object
  Napi::Object result = Napi::Object::New(env);
  result.Set("success", Napi::Boolean::New(env, true));
  result.Set("processId", Napi::Number::New(env, processId));
  result.Set("processName", Napi::String::New(env, utf8ProcessName));
  result.Set("sampleRate", Napi::Number::New(env, pwfx->nSamplesPerSec));
  result.Set("channels", Napi::Number::New(env, pwfx->nChannels));
  result.Set("bitsPerSample", Napi::Number::New(env, pwfx->wBitsPerSample));
  result.Set("usingProcessSpecificLoopback", Napi::Boolean::New(env, usingProcessSpecificLoopback));
  
  // Format information
  if (pwfx->wFormatTag == WAVE_FORMAT_EXTENSIBLE && pwfx->cbSize >= 22) {
    WAVEFORMATEXTENSIBLE* pwfxExt = reinterpret_cast<WAVEFORMATEXTENSIBLE*>(pwfx);
    result.Set("formatType", Napi::String::New(env, "EXTENSIBLE"));
    
    // Check SubFormat
    GUID subFormat = pwfxExt->SubFormat;
    char guidStr[64];
    sprintf_s(guidStr, "{%08lX-%04hX-%04hX-%02hhX%02hhX-%02hhX%02hhX%02hhX%02hhX%02hhX%02hhX}",
              subFormat.Data1, subFormat.Data2, subFormat.Data3,
              subFormat.Data4[0], subFormat.Data4[1], subFormat.Data4[2], subFormat.Data4[3],
              subFormat.Data4[4], subFormat.Data4[5], subFormat.Data4[6], subFormat.Data4[7]);
    
    result.Set("subFormat", Napi::String::New(env, guidStr));
    
    if (subFormat == KSDATAFORMAT_SUBTYPE_PCM) {
      result.Set("formatName", Napi::String::New(env, "PCM"));
    } else if (subFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT) {
      result.Set("formatName", Napi::String::New(env, "IEEE Float"));
    }
  } else if (pwfx->wFormatTag == WAVE_FORMAT_IEEE_FLOAT) {
    result.Set("formatType", Napi::String::New(env, "IEEE Float"));
  } else if (pwfx->wFormatTag == WAVE_FORMAT_PCM) {
    result.Set("formatType", Napi::String::New(env, "PCM"));
  }
  
  return result;
}

// Enumerating windows with executable names
std::vector<WindowInfoStruct> WindowAudioCapture::EnumerateWindows() {
  std::vector<WindowInfoStruct> windows;
  
  // Use EnumWindows with a standard callback
  EnumWindows([](HWND hwnd, LPARAM lParam) -> BOOL {
    auto windowList = reinterpret_cast<std::vector<WindowInfoStruct>*>(lParam);
    
    // Skip invisible windows
    if (!IsWindowVisible(hwnd)) {
      return TRUE;
    }
    
    // Get the window title
    WCHAR title[256];
    GetWindowTextW(hwnd, title, 256);
    
    // Skip windows with empty titles
    if (wcslen(title) == 0) {
      return TRUE;
    }
    
    // Get the process ID for the window
    DWORD processId;
    GetWindowThreadProcessId(hwnd, &processId);
    
    // Get executable name
    std::wstring executableName = GetProcessExecutableName(processId);
    
    // Add to our list
    windowList->push_back({ hwnd, std::wstring(title), processId, executableName });
    return TRUE;
  }, reinterpret_cast<LPARAM>(&windows));
  
  return windows;
}


// Example GetWindowList implementation with executable names
Napi::Value WindowAudioCapture::GetWindowList(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::HandleScope scope(env);
  
  auto windows = EnumerateWindows();
  Napi::Array result = Napi::Array::New(env, windows.size());
  
  for (size_t i = 0; i < windows.size(); i++) {
    Napi::Object window = Napi::Object::New(env);
    
    // Convert window title from wide string to UTF-8
    int titleBufferSize = WideCharToMultiByte(CP_UTF8, 0, windows[i].title.c_str(), -1, NULL, 0, NULL, NULL);
    std::string utf8Title(titleBufferSize, 0);
    WideCharToMultiByte(CP_UTF8, 0, windows[i].title.c_str(), -1, &utf8Title[0], titleBufferSize, NULL, NULL);
    utf8Title.resize(titleBufferSize - 1);  // Remove null terminator from string
    
    // Convert executable name from wide string to UTF-8
    int exeBufferSize = WideCharToMultiByte(CP_UTF8, 0, windows[i].executableName.c_str(), -1, NULL, 0, NULL, NULL);
    std::string utf8ExeName(exeBufferSize, 0);
    WideCharToMultiByte(CP_UTF8, 0, windows[i].executableName.c_str(), -1, &utf8ExeName[0], exeBufferSize, NULL, NULL);
    utf8ExeName.resize(exeBufferSize - 1);  // Remove null terminator from string
    
    window.Set("id", Napi::Number::New(env, reinterpret_cast<uint64_t>(windows[i].hwnd)));
    window.Set("title", Napi::String::New(env, utf8Title));
    window.Set("processId", Napi::Number::New(env, windows[i].processId));
    window.Set("executableName", Napi::String::New(env, utf8ExeName));
    
    result[i] = window;
  }
  
  return result;
}

// Implementation of StopCapture
Napi::Value WindowAudioCapture::StopCapture(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::HandleScope scope(env);
  
  if (!isCapturing) {
    return Napi::Boolean::New(env, true);
  }
  
  // Signal the capture thread to stop
  if (stopEvent) {
    SetEvent(stopEvent);
  }
  
  // Wait for the thread to exit
  if (captureThread) {
    WaitForSingleObject(captureThread, 1000);
    CloseHandle(captureThread);
    captureThread = NULL;
  }
  
  // Stop the audio client
  if (audioClient) {
    audioClient->Stop();
  }
  
  // Release resources
  captureClient = nullptr;
  audioClient = nullptr;
  captureDevice = nullptr;
  targetSessionControl = nullptr;
  
  isCapturing = false;
  
  return Napi::Boolean::New(env, true);
}

// Implementation of GetAudioData
Napi::Value WindowAudioCapture::GetAudioData(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::HandleScope scope(env);
  
  if (!isCapturing) {
    return Napi::Array::New(env, 0);
  }
  
  // Lock the buffer for thread safety
  std::lock_guard<std::mutex> lock(audioBufferMutex);
  
  // Create a new array to hold the audio data
  Napi::Array result = Napi::Array::New(env, audioBuffer.size());
  
  // Copy the audio data to the array
  for (size_t i = 0; i < audioBuffer.size(); i++) {
    result[i] = Napi::Number::New(env, audioBuffer[i]);
  }
  
  // Clear the buffer
  audioBuffer.clear();
  
  return result;
}

// Implementation of StartStreamCapture
Napi::Value WindowAudioCapture::StartStreamCapture(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::HandleScope scope(env);
  
  if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsFunction()) {
    Napi::TypeError::New(env, "Window handle and callback function expected").ThrowAsJavaScriptException();
    return env.Null();
  }
  
  // Stop any existing capture
  if (isCapturing) {
    StopCapture(info);
  }
  
  // Get window handle from parameter
  HWND hwnd = reinterpret_cast<HWND>(info[0].As<Napi::Number>().Int64Value());
  
  // Get the callback function
  Napi::Function callback = info[1].As<Napi::Function>();
  
  // Get process ID for the window
  DWORD processId;
  GetWindowThreadProcessId(hwnd, &processId);
  
  // Set up process-specific capture
  if (!CreateProcessSpecificLoopbackCapture(processId)) {
    Napi::Error::New(env, "Failed to create process-specific loopback capture").ThrowAsJavaScriptException();
    return env.Null();
  }
  
  // Create a ThreadSafeFunction for the audio callback
  tsfn = Napi::ThreadSafeFunction::New(
    env, 
    callback,                   // JavaScript function to call
    "AudioStreamCallback",      // Name
    1,                          // Max queue size (1 to minimize latency)
    1,                          // Initial thread count 
    [](Napi::Env) {}            // Finalize callback
  );
  
  // Set streaming mode
  useStreamCallback = true;
  
  // Reset stop event
  ResetEvent(stopEvent);
  
  // Start capture thread
  captureThread = CreateThread(NULL, 0, ProcessSpecificCaptureThreadProc, this, 0, NULL);
  if (captureThread == NULL) {
    audioClient->Stop();
    useStreamCallback = false;
    tsfn.Release();
    Napi::Error::New(env, "Failed to create capture thread").ThrowAsJavaScriptException();
    return env.Null();
  }
  
  isCapturing = true;
  
  // Return audio format information
  Napi::Object result = Napi::Object::New(env);
  result.Set("success", Napi::Boolean::New(env, true));
  result.Set("sampleRate", Napi::Number::New(env, pwfx->nSamplesPerSec));
  result.Set("channels", Napi::Number::New(env, pwfx->nChannels));
  result.Set("bitsPerSample", Napi::Number::New(env, pwfx->wBitsPerSample));
  
  return result;
}

// Constructor and Destructor implementation
WindowAudioCapture::WindowAudioCapture(const Napi::CallbackInfo& info) 
  : Napi::ObjectWrap<WindowAudioCapture>(info) {
  Napi::Env env = info.Env();
  Napi::HandleScope scope(env);
  
  // Initialize COM
  HRESULT hr = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
  if (FAILED(hr)) {
    Napi::Error::New(env, "Failed to initialize COM library").ThrowAsJavaScriptException();
    return;
  }
  
  // Create device enumerator
  hr = CoCreateInstance(
    __uuidof(MMDeviceEnumerator), 
    NULL, 
    CLSCTX_ALL, 
    __uuidof(IMMDeviceEnumerator), 
    (void**)deviceEnumerator.GetAddressOf()
  );
  
  if (FAILED(hr)) {
    Napi::Error::New(env, "Failed to create device enumerator").ThrowAsJavaScriptException();
    return;
  }
  
  // Create stop event for capture thread
  stopEvent = CreateEvent(NULL, TRUE, FALSE, NULL);
  if (stopEvent == NULL) {
    Napi::Error::New(env, "Failed to create stop event").ThrowAsJavaScriptException();
    return;
  }
}

WindowAudioCapture::~WindowAudioCapture() {
  // Stop any active capture
  if (isCapturing) {
    // Don't try to call StopCapture with a default-constructed CallbackInfo
    // Stop capture directly rather than through the Node-API method
    if (audioClient) {
      audioClient->Stop();
    }
    
    if (stopEvent) {
      SetEvent(stopEvent);
    }
    
    if (captureThread) {
      WaitForSingleObject(captureThread, 1000);
      CloseHandle(captureThread);
      captureThread = NULL;
    }
    
    isCapturing = false;
  }
  
  if (pwfx) {
    CoTaskMemFree(pwfx);
    pwfx = nullptr;
  }
  
  if (stopEvent) {
    CloseHandle(stopEvent);
    stopEvent = NULL;
  }
  
  CoUninitialize();
}

// Static initialization code
Napi::FunctionReference WindowAudioCapture::constructor;

Napi::Object WindowAudioCapture::Init(Napi::Env env, Napi::Object exports) {
  Napi::HandleScope scope(env);
  
  Napi::Function func = DefineClass(env, "WindowAudioCapture", {
    InstanceMethod("getWindowList", &WindowAudioCapture::GetWindowList),
    InstanceMethod("getAudioSessions", &WindowAudioCapture::GetAudioSessions),  // Add this
    InstanceMethod("startCapture", &WindowAudioCapture::StartCapture),
    InstanceMethod("startStreamCapture", &WindowAudioCapture::StartStreamCapture),
    InstanceMethod("stopCapture", &WindowAudioCapture::StopCapture),
    InstanceMethod("getAudioData", &WindowAudioCapture::GetAudioData)
  });
  
  constructor = Napi::Persistent(func);
  constructor.SuppressDestruct();
  
  exports.Set("WindowAudioCapture", func);
  return exports;
}

// Module initialization
Napi::Object InitModule(Napi::Env env, Napi::Object exports) {
  return WindowAudioCapture::Init(env, exports);
}

NODE_API_MODULE(window_audio_capture, InitModule)