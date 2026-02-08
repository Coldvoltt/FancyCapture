import { useEffect, useState, useRef } from 'react';
import { isElectron } from '../platform';

interface CameraBubbleConfig {
  deviceId: string | null;
  shape: string;
}

function CameraBubbleInner() {
  const [config, setConfig] = useState<CameraBubbleConfig>({ deviceId: null, shape: 'circle' });
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    // Listen for config from main process
    window.electronAPI.onCameraBubbleConfig((cfg: CameraBubbleConfig) => {
      setConfig(cfg);
    });

    // Make body transparent and draggable
    document.body.style.background = 'transparent';
    document.documentElement.style.background = 'transparent';
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';
    document.body.style.setProperty('-webkit-app-region', 'drag');

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Start/update camera stream when config changes
  useEffect(() => {
    let mounted = true;

    const startCamera = async () => {
      // Stop existing stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }

      try {
        const constraints: MediaStreamConstraints = {
          video: config.deviceId
            ? { deviceId: { exact: config.deviceId }, width: { ideal: 640 }, height: { ideal: 640 } }
            : { width: { ideal: 640 }, height: { ideal: 640 } },
          audio: false,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (!mounted) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        console.error('CameraBubble: failed to start camera:', err);
      }
    };

    startCamera();

    return () => {
      mounted = false;
    };
  }, [config.deviceId]);

  const shapeClass = config.shape === 'circle' ? 'rounded-full' : 'rounded-2xl';

  return (
    <div className={`w-full h-full overflow-hidden ${shapeClass}`}>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className={`w-full h-full object-cover transform scale-x-[-1] ${shapeClass}`}
      />
    </div>
  );
}

function CameraBubble() {
  if (!isElectron) return null;
  return <CameraBubbleInner />;
}

export default CameraBubble;
