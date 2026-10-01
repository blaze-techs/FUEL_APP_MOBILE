import { useState, useRef, useEffect, useCallback } from "react";
import {
  X,
  Crop,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Check,
  RefreshCw,
  Sparkles,
} from "lucide-react";

interface ImageCropperProps {
  file: File;
  onCrop: (croppedFile: File) => void;
  onCancel: () => void;
}

interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export default function ImageCropper({
  file,
  onCrop,
  onCancel,
}: ImageCropperProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [sourceDimensions, setSourceDimensions] = useState({ width: 0, height: 0 });
  const [cropArea, setCropArea] = useState<CropArea | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [displayScale, setDisplayScale] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ width: 300, height: 400 });
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [enhancedImage, setEnhancedImage] = useState<HTMLImageElement | null>(
    null,
  );

  // Load and normalize the source orientation once. The editor must never
  // rotate a portrait source merely to fit the screen. The preview is always
  // fitted with CSS/canvas while retaining the source aspect ratio.
  useEffect(() => {
    let cancelled = false;
    const objectUrl = URL.createObjectURL(file);

    const load = async () => {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        if (cancelled) {
          bitmap.close();
          return;
        }
        const normalized = document.createElement("canvas");
        normalized.width = bitmap.width;
        normalized.height = bitmap.height;
        const nctx = normalized.getContext("2d");
        if (!nctx) {
          bitmap.close();
          return;
        }
        nctx.drawImage(bitmap, 0, 0);
        bitmap.close();

        const img = new Image();
        img.onload = () => {
          if (cancelled) return;
          setImage(img);
          setSourceDimensions({ width: img.naturalWidth, height: img.naturalHeight });
          setCropArea(null);
          setRotation(0);
          setZoom(1);
        };
        img.src = normalized.toDataURL("image/png");
      } catch {
        const img = new Image();
        img.onload = () => {
          if (cancelled) return;
          setImage(img);
          setSourceDimensions({ width: img.naturalWidth, height: img.naturalHeight });
          setCropArea(null);
          setRotation(0);
          setZoom(1);
        };
        img.src = objectUrl;
      }
    };

    load();
    return () => {
      cancelled = true;
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  // Resize the preview only. Rotation swaps the rendered bounds; it never
  // changes the source image itself until the user explicitly rotates it.
  useEffect(() => {
    if (!image) return;

    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const availableHeight = Math.max(240, viewportHeight - 300);
    const availableWidth = Math.max(280, Math.min(viewportWidth - 32, 900));

    const rotated = rotation % 180 !== 0;
    const sourceW = rotated ? image.naturalHeight : image.naturalWidth;
    const sourceH = rotated ? image.naturalWidth : image.naturalHeight;
    const fit = Math.min(availableWidth / sourceW, availableHeight / sourceH);
    const safeFit = Math.max(0.1, fit);
    const displayW = sourceW * safeFit * zoom;
    const displayH = sourceH * safeFit * zoom;

    setDisplayScale(safeFit * zoom);
    setCanvasSize({
      width: Math.max(1, Math.round(displayW)),
      height: Math.max(1, Math.round(displayH)),
    });
  }, [image, rotation, zoom]);

  // Draw image on canvas
  useEffect(() => {
    if (!canvasRef.current || !image) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Use enhanced image if available
    const sourceImage = enhancedImage || image;

    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();

    // Apply rotation around center
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);

    const drawWidth = sourceImage.naturalWidth * displayScale;
    const drawHeight = sourceImage.naturalHeight * displayScale;

    ctx.drawImage(
      sourceImage,
      -drawWidth / 2,
      -drawHeight / 2,
      drawWidth,
      drawHeight,
    );
    ctx.restore();

    // Draw crop overlay if exists
    if (cropArea) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
      ctx.fillRect(0, 0, canvas.width, cropArea.y);
      ctx.fillRect(
        0,
        cropArea.y + cropArea.height,
        canvas.width,
        canvas.height - cropArea.y - cropArea.height,
      );
      ctx.fillRect(0, cropArea.y, cropArea.x, cropArea.height);
      ctx.fillRect(
        cropArea.x + cropArea.width,
        cropArea.y,
        canvas.width - cropArea.x - cropArea.width,
        cropArea.height,
      );

      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(cropArea.x, cropArea.y, cropArea.width, cropArea.height);

      const handleSize = 10;
      ctx.fillStyle = "#f59e0b";
      ctx.setLineDash([]);
      ctx.fillRect(
        cropArea.x - handleSize / 2,
        cropArea.y - handleSize / 2,
        handleSize,
        handleSize,
      );
      ctx.fillRect(
        cropArea.x + cropArea.width - handleSize / 2,
        cropArea.y - handleSize / 2,
        handleSize,
        handleSize,
      );
      ctx.fillRect(
        cropArea.x - handleSize / 2,
        cropArea.y + cropArea.height - handleSize / 2,
        handleSize,
        handleSize,
      );
      ctx.fillRect(
        cropArea.x + cropArea.width - handleSize / 2,
        cropArea.y + cropArea.height - handleSize / 2,
        handleSize,
        handleSize,
      );
    }
  }, [image, enhancedImage, cropArea, rotation, canvasSize]);

  // Enhance image for better AI reading
  const enhanceImage = useCallback(() => {
    if (!image) return;
    setIsEnhancing(true);

    // Create canvas for enhancement
    const enhanceCanvas = document.createElement("canvas");
    const ctx = enhanceCanvas.getContext("2d");
    if (!ctx) {
      setIsEnhancing(false);
      return;
    }

    enhanceCanvas.width = image.width;
    enhanceCanvas.height = image.height;

    // Draw original image
    ctx.drawImage(image, 0, 0);

    // Get image data
    const imageData = ctx.getImageData(
      0,
      0,
      enhanceCanvas.width,
      enhanceCanvas.height,
    );
    const data = imageData.data;

    // Step 1: Convert to grayscale and increase contrast
    const contrastFactor = 1.4; // Increase contrast
    const brightnessFactor = 10; // Slight brightness boost

    for (let i = 0; i < data.length; i += 4) {
      // Grayscale conversion (weighted average)
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;

      // Apply contrast
      let adjusted = (gray - 128) * contrastFactor + 128 + brightnessFactor;
      adjusted = Math.max(0, Math.min(255, adjusted));

      data[i] = adjusted; // R
      data[i + 1] = adjusted; // G
      data[i + 2] = adjusted; // B
    }

    // Step 2: Apply simple sharpening kernel
    const tempData = new Uint8ClampedArray(data);
    const width = enhanceCanvas.width;
    const height = enhanceCanvas.height;

    // Sharpening kernel
    const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let sum = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = ((y + ky) * width + (x + kx)) * 4;
            sum += tempData[idx] * kernel[(ky + 1) * 3 + (kx + 1)];
          }
        }
        const idx = (y * width + x) * 4;
        const clamped = Math.max(0, Math.min(255, sum));
        data[idx] = clamped;
        data[idx + 1] = clamped;
        data[idx + 2] = clamped;
      }
    }

    // Step 3: Adaptive thresholding for cleaner text
    // Apply a soft threshold to make text more distinct
    for (let i = 0; i < data.length; i += 4) {
      const val = data[i];
      // Soft threshold - push towards black or white
      if (val < 100) {
        data[i] = data[i + 1] = data[i + 2] = Math.max(0, val - 30);
      } else if (val > 180) {
        data[i] = data[i + 1] = data[i + 2] = Math.min(255, val + 30);
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // Create enhanced image
    const enhancedImg = new Image();
    enhancedImg.onload = () => {
      setEnhancedImage(enhancedImg);
      setIsEnhancing(false);
    };
    enhancedImg.src = enhanceCanvas.toDataURL("image/jpeg", 0.95);
  }, [image]);

  const getCanvasCoords = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!canvasRef.current) return { x: 0, y: 0 };

      const rect = canvasRef.current.getBoundingClientRect();
      let clientX, clientY;

      if ("touches" in e) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }

      // Scale coordinates to match actual canvas size
      const scaleX = canvasRef.current.width / rect.width;
      const scaleY = canvasRef.current.height / rect.height;

      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
      };
    },
    [],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      const coords = getCanvasCoords(e);
      setIsDragging(true);
      setDragStart(coords);
      setCropArea({ x: coords.x, y: coords.y, width: 0, height: 0 });
    },
    [getCanvasCoords],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!isDragging || !canvasRef.current) return;
      e.preventDefault();

      const coords = getCanvasCoords(e);
      const canvas = canvasRef.current;

      const x = Math.max(0, Math.min(dragStart.x, coords.x));
      const y = Math.max(0, Math.min(dragStart.y, coords.y));
      const width = Math.min(
        Math.abs(coords.x - dragStart.x),
        canvas.width - x,
      );
      const height = Math.min(
        Math.abs(coords.y - dragStart.y),
        canvas.height - y,
      );

      setCropArea({ x, y, width, height });
    },
    [isDragging, dragStart, getCanvasCoords],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    if (cropArea && (cropArea.width < 20 || cropArea.height < 20)) {
      setCropArea(null);
    }
  }, [cropArea]);

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
    setCropArea(null);
  };

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.25, 0.5));
  const handleResetCrop = () => setCropArea(null);

  const handleConfirmCrop = async () => {
    if (!image) return;

    const sourceImage = enhancedImage || image;
    const sourceW = sourceImage.naturalWidth;
    const sourceH = sourceImage.naturalHeight;
    const radians = (rotation * Math.PI) / 180;
    const rotatedW = rotation % 180 === 0 ? sourceW : sourceH;
    const rotatedH = rotation % 180 === 0 ? sourceH : sourceW;

    // Render the user-selected orientation at native resolution first. This
    // prevents portrait pages from being flattened into a landscape canvas.
    const rotatedCanvas = document.createElement("canvas");
    rotatedCanvas.width = rotatedW;
    rotatedCanvas.height = rotatedH;
    const rotatedCtx = rotatedCanvas.getContext("2d");
    if (!rotatedCtx) return;
    rotatedCtx.translate(rotatedW / 2, rotatedH / 2);
    rotatedCtx.rotate(radians);
    rotatedCtx.drawImage(sourceImage, -sourceW / 2, -sourceH / 2, sourceW, sourceH);

    let outputCanvas = rotatedCanvas;

    if (cropArea && cropArea.width >= 20 && cropArea.height >= 20) {
      const cropScale = displayScale || 1;
      const cropX = Math.max(0, Math.round(cropArea.x / cropScale));
      const cropY = Math.max(0, Math.round(cropArea.y / cropScale));
      const cropW = Math.min(rotatedW - cropX, Math.round(cropArea.width / cropScale));
      const cropH = Math.min(rotatedH - cropY, Math.round(cropArea.height / cropScale));

      if (cropW > 1 && cropH > 1) {
        const cropped = document.createElement("canvas");
        cropped.width = cropW;
        cropped.height = cropH;
        const cropCtx = cropped.getContext("2d");
        if (!cropCtx) return;
        cropCtx.drawImage(rotatedCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        outputCanvas = cropped;
      }
    }

    outputCanvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCrop(
          new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
            type: "image/jpeg",
            lastModified: Date.now(),
          }),
        );
      },
      "image/jpeg",
      0.96,
    );
  };

  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-white dark:bg-gray-900 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <Crop className="w-5 h-5 text-amber-500" />
          <h2 className="text-gray-900 dark:text-white font-semibold">
            Crop & Enhance
          </h2>
          {enhancedImage && (
            <span className="px-2 py-0.5 bg-green-600 text-gray-900 dark:text-white text-xs rounded">
              Enhanced
            </span>
          )}
        </div>
        <button
          onClick={onCancel}
          className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:text-white p-1"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Instructions */}
      <div className="bg-amber-900/40 px-4 py-2 text-amber-200 text-xs text-center">
        Portrait-safe preview • Drag to crop • Rotate only if the source is actually sideways
      </div>

      {/* Canvas Container */}
      <div className="flex-1 flex items-center justify-center p-4 overflow-auto bg-gray-950 min-h-0">
        {image ? (
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleMouseDown}
            onTouchMove={handleMouseMove}
            onTouchEnd={handleMouseUp}
            className="cursor-crosshair border-2 border-gray-600 rounded-lg touch-none shadow-2xl object-contain max-w-full max-h-full"
            style={{ width: `${canvasSize.width}px`, height: `${canvasSize.height}px`, maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
          />
        ) : (
          <div className="text-gray-500 dark:text-gray-400 text-center">
            <div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full mx-auto mb-2"></div>
            <p>Loading image...</p>
          </div>
        )}
      </div>

      {/* Tools */}
      <div className="flex items-center justify-center gap-2 p-3 bg-white dark:bg-gray-900 border-t border-gray-700 flex-wrap">
        <button
          onClick={enhanceImage}
          disabled={isEnhancing}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-colors ${
            enhancedImage
              ? "bg-green-600 text-gray-900 dark:text-white"
              : "bg-purple-600 hover:bg-purple-500 text-gray-900 dark:text-white"
          } ${isEnhancing ? "opacity-50 cursor-wait" : ""}`}
        >
          <Sparkles className="w-4 h-4" />
          {isEnhancing
            ? "Enhancing..."
            : enhancedImage
              ? "Enhanced"
              : "Enhance"}
        </button>
        <button
          onClick={handleRotate}
          className="flex items-center gap-1.5 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-900 dark:text-white rounded-lg transition-colors"
        >
          <RotateCw className="w-4 h-4" />
          Rotate
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={handleZoomOut}
            className="p-2 bg-gray-700 hover:bg-gray-600 text-gray-900 dark:text-white rounded-lg transition-colors disabled:opacity-50"
            disabled={zoom <= 0.5}
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-gray-900 dark:text-white text-xs w-12 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={handleZoomIn}
            className="p-2 bg-gray-700 hover:bg-gray-600 text-gray-900 dark:text-white rounded-lg transition-colors disabled:opacity-50"
            disabled={zoom >= 3}
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>
        {cropArea && cropArea.width > 20 && (
          <button
            onClick={handleResetCrop}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-900 dark:text-white rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Reset
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-center gap-3 p-3 bg-white dark:bg-gray-800">
        <button
          onClick={onCancel}
          className="px-5 py-2.5 bg-gray-600 hover:bg-gray-500 text-gray-900 dark:text-white rounded-lg font-medium transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirmCrop}
          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-gray-900 dark:text-white rounded-lg font-semibold transition-colors shadow-lg fp-icon-only"
          title="Confirm"
          aria-label="Confirm"
        >
          <Check className="w-5 h-5" />
          {cropArea && cropArea.width > 20 ? "Crop & Scan" : "Scan Image"}
        </button>
      </div>
    </div>
  );
}
