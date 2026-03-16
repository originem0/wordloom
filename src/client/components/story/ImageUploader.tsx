import { useCallback, useRef, useState } from "react";
import { ImagePlus, RefreshCw } from "lucide-react";
import { Button } from "@/client/components/ui/button";

interface ImageUploaderProps {
  onImageSelect: (file: File) => void;
  imagePreview: string | null;
}

const ACCEPTED = ".jpg,.jpeg,.png,.webp";

export function ImageUploader({ onImageSelect, imagePreview }: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) return;
      onImageSelect(file);
    },
    [onImageSelect],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      // reset so the same file can be re-selected
      e.target.value = "";
    },
    [handleFile],
  );

  if (imagePreview) {
    return (
      <div className="relative overflow-hidden rounded-lg border">
        <img
          src={imagePreview}
          alt="Selected"
          className="aspect-[4/3] w-full object-cover"
        />
        <div className="absolute bottom-2 right-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => inputRef.current?.click()}
          >
            <RefreshCw className="size-3.5" />
            更换图片
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={onInputChange}
        />
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={`flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed transition-colors ${
        dragOver
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/25 hover:border-muted-foreground/50"
      }`}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <ImagePlus className="size-10 text-muted-foreground/50" />
      <div className="text-center">
        <p className="text-sm font-medium text-muted-foreground">
          拖拽图片到此处或点击选择
        </p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          JPG, PNG, WebP (最大 10MB)
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={onInputChange}
      />
    </div>
  );
}
