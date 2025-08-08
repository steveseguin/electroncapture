using System;
using System.Runtime.InteropServices;
using System.Threading;

class ToneGenerator
{
    // Windows Multimedia API
    [DllImport("winmm.dll", SetLastError = true)]
    static extern uint waveOutOpen(out IntPtr hWaveOut, uint uDeviceID, ref WAVEFORMATEX lpFormat,
        IntPtr dwCallback, IntPtr dwInstance, uint dwFlags);

    [DllImport("winmm.dll", SetLastError = true)]
    static extern uint waveOutPrepareHeader(IntPtr hWaveOut, ref WAVEHDR lpWaveOutHdr, uint uSize);

    [DllImport("winmm.dll", SetLastError = true)]
    static extern uint waveOutWrite(IntPtr hWaveOut, ref WAVEHDR lpWaveOutHdr, uint uSize);

    [DllImport("winmm.dll", SetLastError = true)]
    static extern uint waveOutUnprepareHeader(IntPtr hWaveOut, ref WAVEHDR lpWaveOutHdr, uint uSize);

    [DllImport("winmm.dll", SetLastError = true)]
    static extern uint waveOutClose(IntPtr hWaveOut);

    [StructLayout(LayoutKind.Sequential)]
    struct WAVEFORMATEX
    {
        public ushort wFormatTag;
        public ushort nChannels;
        public uint nSamplesPerSec;
        public uint nAvgBytesPerSec;
        public ushort nBlockAlign;
        public ushort wBitsPerSample;
        public ushort cbSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct WAVEHDR
    {
        public IntPtr lpData;
        public uint dwBufferLength;
        public uint dwBytesRecorded;
        public IntPtr dwUser;
        public uint dwFlags;
        public uint dwLoops;
        public IntPtr lpNext;
        public IntPtr reserved;
    }

    const uint WAVE_MAPPER = 0xFFFFFFFF;
    const ushort WAVE_FORMAT_PCM = 1;
    const uint WHDR_DONE = 0x00000001;

    static void Main(string[] args)
    {
        Console.WriteLine("=== Windows Tone Generator ===");
        Console.WriteLine("Frequency: 440 Hz");
        Console.WriteLine("Duration: 3 seconds");
        Console.WriteLine();

        // Generate 440Hz tone
        int sampleRate = 44100;
        int frequency = 440;
        int duration = 3; // seconds
        
        // Calculate buffer size
        int numSamples = sampleRate * duration;
        short[] samples = new short[numSamples];
        
        // Generate sine wave
        for (int i = 0; i < numSamples; i++)
        {
            double t = (double)i / sampleRate;
            double value = Math.Sin(2 * Math.PI * frequency * t);
            samples[i] = (short)(value * 32767);
        }

        // Set up wave format
        WAVEFORMATEX format = new WAVEFORMATEX();
        format.wFormatTag = WAVE_FORMAT_PCM;
        format.nChannels = 1;
        format.nSamplesPerSec = (uint)sampleRate;
        format.wBitsPerSample = 16;
        format.nBlockAlign = (ushort)(format.nChannels * format.wBitsPerSample / 8);
        format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;
        format.cbSize = 0;

        // Open wave output
        IntPtr hWaveOut;
        uint result = waveOutOpen(out hWaveOut, WAVE_MAPPER, ref format, IntPtr.Zero, IntPtr.Zero, 0);
        if (result != 0)
        {
            Console.WriteLine("Failed to open wave output: " + result);
            return;
        }

        // Prepare header
        GCHandle dataHandle = GCHandle.Alloc(samples, GCHandleType.Pinned);
        WAVEHDR header = new WAVEHDR();
        header.lpData = dataHandle.AddrOfPinnedObject();
        header.dwBufferLength = (uint)(samples.Length * 2);
        header.dwFlags = 0;

        result = waveOutPrepareHeader(hWaveOut, ref header, (uint)Marshal.SizeOf(header));
        if (result != 0)
        {
            Console.WriteLine("Failed to prepare header: " + result);
            waveOutClose(hWaveOut);
            dataHandle.Free();
            return;
        }

        // Play the tone
        Console.WriteLine("Playing tone...");
        result = waveOutWrite(hWaveOut, ref header, (uint)Marshal.SizeOf(header));
        if (result != 0)
        {
            Console.WriteLine("Failed to write audio: " + result);
        }

        // Wait for playback to complete
        while ((header.dwFlags & WHDR_DONE) == 0)
        {
            Thread.Sleep(100);
            // Re-read the header to check if done
            header = (WAVEHDR)Marshal.PtrToStructure(GCHandle.Alloc(header, GCHandleType.Pinned).AddrOfPinnedObject(), typeof(WAVEHDR));
        }

        Console.WriteLine("Tone finished.");

        // Cleanup
        waveOutUnprepareHeader(hWaveOut, ref header, (uint)Marshal.SizeOf(header));
        waveOutClose(hWaveOut);
        dataHandle.Free();
    }
}