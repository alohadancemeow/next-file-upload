import { useState } from "react";
import { toast } from "sonner";

type FileState = {
  id: string; // id of the file
  file: File; // file object
  uploading: boolean; // true if the file is uploading
  progress: number; // progress of the upload
  key?: string; // key of the file in s3
  isDeleting: boolean; // true if the file is being deleted
  error: boolean; // true if the file has an error
  objectUrl?: string; // url of the file
};

export function useFileUpload() {
  const [files, setFiles] = useState<FileState[]>([]);

  // # Upload file to s3
  const uploadFile = async (file: File) => {
    setFiles((prevFiles) =>
      prevFiles.map((f) => (f.file === file ? { ...f, uploading: true } : f))
    );

    try {
      // 1. Get presigned URL
      const presignedResponse = await fetch("/api/s3/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          size: file.size,
        }),
      });

      if (!presignedResponse.ok) {
        toast.error("Failed to get presigned URL");

        setFiles((prevFiles) =>
          prevFiles.map((f) =>
            f.file === file
              ? { ...f, uploading: false, progress: 0, error: true }
              : f
          )
        );

        return;
      }

      const { presignedUrl, key } = await presignedResponse.json();

      // 2. Upload file to S3 using XMLHttpRequest for progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percentComplete = (event.loaded / event.total) * 100;
            setFiles((prevFiles) =>
              prevFiles.map((f) =>
                f.file === file
                  ? { ...f, progress: Math.round(percentComplete), key: key }
                  : f
              )
            );
          }
        };

        xhr.onload = () => {
          if (xhr.status === 200 || xhr.status === 204) {
            // Create object URL for preview
            const objectUrl = URL.createObjectURL(file);

            setFiles((prevFiles) =>
              prevFiles.map((f) =>
                f.file === file
                  ? {
                      ...f,
                      progress: 100,
                      uploading: false,
                      error: false,
                      objectUrl,
                      key,
                    }
                  : f
              )
            );

            toast.success("File uploaded successfully");
            resolve();
          } else {
            reject(new Error(`Upload failed with status: ${xhr.status}`));
          }
        };

        xhr.onerror = () => {
          reject(new Error("Upload failed"));
        };

        xhr.open("PUT", presignedUrl);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.send(file);
      });
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Something went wrong");

      setFiles((prevFiles) =>
        prevFiles.map((f) =>
          f.file === file
            ? { ...f, uploading: false, progress: 0, error: true }
            : f
        )
      );
    }
  };

  // # Remove file from s3
  const removeFile = async (fileId: string) => {
    try {
      const fileToRemove = files.find((f) => f.id === fileId);
      if (fileToRemove) {
        if (fileToRemove.objectUrl) {
          URL.revokeObjectURL(fileToRemove.objectUrl);
        }
      }

      setFiles((prevFiles) =>
        prevFiles.map((f) => (f.id === fileId ? { ...f, isDeleting: true } : f))
      );

      const response = await fetch("/api/s3/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: fileToRemove?.key }),
      });

      if (!response.ok) {
        toast.error("Failed to remove file from storage.");
        setFiles((prevFiles) =>
          prevFiles.map((f) =>
            f.id === fileId ? { ...f, isDeleting: false, error: true } : f
          )
        );
        return;
      }

      setFiles((prevFiles) => prevFiles.filter((f) => f.id !== fileId));
      toast.success("File removed successfully");
    } catch (error) {
      console.error("Delete error:", error);
      toast.error("Failed to remove file from storage.");
      setFiles((prevFiles) =>
        prevFiles.map((f) =>
          f.id === fileId ? { ...f, isDeleting: false, error: true } : f
        )
      );
    }
  };

  return {
    files,
    setFiles,
    removeFile,
    uploadFile,
  };
}
