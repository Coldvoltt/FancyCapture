import { useEffect } from 'react';
import { useStore } from './store/useStore';
import { platform, isElectron } from './platform';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import Preview from './components/Preview';
import SourcePicker from './components/SourcePicker';
import RecordingControls from './components/RecordingControls';
import Settings from './components/Settings';

function App() {
  const { showSourcePicker, showSettings, setOutputFolder, setAvailableCameras, setAvailableMicrophones } =
    useStore();

  useEffect(() => {
    // Initialize default output folder
    const initFolder = async () => {
      const defaultFolder = await platform.getDefaultFolder();
      setOutputFolder(defaultFolder);
    };
    initFolder();

    // Get available media devices
    const getDevices = async () => {
      try {
        // Request permissions first
        await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter((d) => d.kind === 'videoinput');
        const microphones = devices.filter((d) => d.kind === 'audioinput');

        setAvailableCameras(cameras);
        setAvailableMicrophones(microphones);
      } catch (error) {
        console.error('Error getting media devices:', error);
      }
    };
    getDevices();

    // Listen for device changes
    navigator.mediaDevices.addEventListener('devicechange', getDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', getDevices);
    };
  }, [setOutputFolder, setAvailableCameras, setAvailableMicrophones]);

  return (
    <div className="h-full flex flex-col">
      <Header />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col p-4 overflow-hidden">
          <Preview />
          <RecordingControls />
        </main>
      </div>
      {showSourcePicker && isElectron && <SourcePicker />}
      {showSettings && <Settings />}
    </div>
  );
}

export default App;
