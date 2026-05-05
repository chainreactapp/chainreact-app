import React, { useRef, useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { X, Upload, File, AlertCircle, Image as ImageIcon, FileText, FileSpreadsheet, Presentation, FileVideo, FileAudio, FileArchive, FileCode } from 'lucide-react'
import { cn } from '@/lib/utils'

import { logger } from '@/lib/utils/logger'

interface FileUploadProps {
  value?: FileList | File[]
  onChange: (files: FileList | File[]) => void
  accept?: string
  maxSize?: number
  maxFiles?: number
  className?: string
  placeholder?: string
  disabled?: boolean
  hideUploadedFiles?: boolean
}

interface UploadedFile {
  file: File
  id: string
  progress: number
  error?: string
  isFileId?: boolean
  isFileMetadata?: boolean
  previewUrl?: string
  actualSize?: number
  actualName?: string
  actualType?: string
  filePath?: string
}

export function FileUpload({
  value,
  onChange,
  accept = "*/*",
  maxSize = 10 * 1024 * 1024, // 10MB default
  maxFiles = 5,
  className,
  placeholder = "Choose files to upload...",
  disabled = false,
  hideUploadedFiles = false,
  multiple = false
}: FileUploadProps & { multiple?: boolean }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [errors, setErrors] = useState<string[]>([])

  // Track loaded preview URLs to prevent duplicate API calls
  const loadedPreviewsRef = useRef<Set<string>>(new Set())
  const prevValueRef = useRef<any>(null)
  const loadingPreviewsRef = useRef<Set<string>>(new Set())

  // Initialize uploaded files from value prop
  useEffect(() => {
    logger.info('📸 [FileUpload] Value prop changed:', {
      value,
      hasValue: !!value,
      length: value?.length,
      firstFile: value?.[0]
    })

    // Check if value has changed (new file or modal reopened)
    const valueChanged = JSON.stringify(value) !== JSON.stringify(prevValueRef.current)
    if (valueChanged) {
      logger.info('📸 [FileUpload] Value changed, clearing preview cache')
      // Clear preview tracking when value changes to allow reloading
      loadedPreviewsRef.current.clear()
      loadingPreviewsRef.current.clear()
      prevValueRef.current = value
    }

    if (value && value.length > 0) {
      const loadFilesWithPreviews = async () => {
        const initialFiles: UploadedFile[] = await Promise.all(
          Array.from(value).map(async (file, index) => {
        // Check if it's a file ID string (from storage API)
        if (typeof file === 'string') {
          return {
            file: new Blob([], { type: 'application/octet-stream' }) as File,
            id: file,
            progress: 100,
            isFileId: true // Flag to indicate this is a file ID
          }
        }
        
        // Check if it's a file metadata object (from Google Drive or other integrations)
        // Check for File-like properties instead of using instanceof
        const hasFileProperties = file && typeof file === 'object' &&
          'size' in file && 'type' in file && 'name' in file &&
          typeof file.slice === 'function';

        // Check if it's our special format with base64 URL (for saved attachments)
        if (file && typeof file === 'object' && file.url && typeof file.url === 'string' && file.url.startsWith('data:')) {
          // This is a saved file with base64 data URL
          logger.info('📸 [FileUpload] Processing saved file with base64 URL:', {
            name: file.name,
            size: file.size,
            type: file.type,
            urlLength: file.url.length
          });

          const uploadedFile: UploadedFile = {
            file: new Blob([], { type: file.type || 'application/octet-stream' }) as File,
            id: `file-${file.name || 'file'}-${index}`,
            progress: 100,
            isFileMetadata: true,
            actualSize: file.size || 0,
            actualName: file.name || 'File',
            actualType: file.type || 'application/octet-stream',
            previewUrl: file.url // Use the base64 URL directly as preview
          };

          // Override the name property
          Object.defineProperty(uploadedFile.file, 'name', {
            value: file.name || 'File',
            writable: false
          });

          logger.info('📸 [FileUpload] Loaded saved file with base64 URL:', {
            name: uploadedFile.actualName,
            size: uploadedFile.actualSize,
            type: uploadedFile.actualType,
            hasPreview: !!uploadedFile.previewUrl
          });

          return uploadedFile;
        } else if (file && typeof file === 'object' && !hasFileProperties) {
          // Create a minimal File-like object for display purposes
          // Create a blob with dummy data matching the reported size (if available)
          const fileSize = file.fileSize || file.size || 0;
          const dummyData = fileSize > 0 ? new ArrayBuffer(1) : new ArrayBuffer(0); // Just create a small buffer
          const fileBlob = new Blob([dummyData], { type: file.fileType || file.type || 'application/octet-stream' }) as File;

          // Override the name property
          Object.defineProperty(fileBlob, 'name', {
            value: file.name || file.fileName || `File ${index + 1}`,
            writable: false
          });

          // Store the actual file size and other metadata separately
          const uploadedFile: UploadedFile = {
            file: fileBlob,
            id: file.id || file.fileId || `${file.name || 'file'}-${fileSize}-${index}`,
            progress: 100,
            isFileMetadata: true, // Flag to indicate this is file metadata
            // Store actual metadata for display
            actualSize: fileSize,
            actualName: file.name || file.fileName || `File ${index + 1}`,
            actualType: file.fileType || file.type
          }

          logger.info('📸 [FileUpload] Processing saved file:', {
            fileName: uploadedFile.actualName,
            fileType: uploadedFile.actualType,
            filePath: file.filePath,
            isImage: (file.fileType || file.type)?.startsWith('image/')
          })

          // Generate preview URL if it's an image and we have a file path
          if ((file.fileType || file.type)?.startsWith('image/') && file.filePath) {
            // Store the path for potential preview generation
            uploadedFile.filePath = file.filePath;

            // Check if we're not already loading this preview
            if (!loadingPreviewsRef.current.has(file.filePath)) {
              loadingPreviewsRef.current.add(file.filePath);

              // Try to fetch the preview URL from Supabase storage - await it to ensure it completes
              try {
                // PR-AUTH-5: cached auth header. Missing token → server 401
                // → preview unavailable; existing fall-through behavior
                // (file shows without preview thumbnail) is preserved.
                const { getAuthHeader } = await import('@/lib/auth/getAuthHeader');
                const authHeader = await getAuthHeader();

                if (authHeader.Authorization) {
                  const response = await fetch('/api/storage/sign-url', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      ...authHeader,
                    },
                    body: JSON.stringify({
                      bucket: 'workflow-files',
                      path: file.filePath,
                      expiresIn: 3600,
                    })
                  });

                  if (response.ok) {
                    const result = await response.json();
                    logger.info('📸 [FileUpload] Preview API response:', {
                      hasPreviewUrl: !!result.signedUrl,
                      signedUrl: result.signedUrl?.substring(0, 100)
                    });
                    if (result.signedUrl) {
                      uploadedFile.previewUrl = result.signedUrl;
                      logger.info('📸 [FileUpload] Set preview URL for file:', uploadedFile.actualName);
                    }
                  } else {
                    logger.info('📸 [FileUpload] Preview API failed:', response.status);
                  }
                }
              } catch (error) {
                console.debug('Could not fetch preview URL:', error);
              } finally {
                // Remove from loading set when done
                loadingPreviewsRef.current.delete(file.filePath);
              }
            } else {
              logger.info('📸 [FileUpload] Already loading preview for:', file.filePath);
            }
          }

          return uploadedFile
        }
        
        // It's a File object
        const uploadedFile: UploadedFile = {
          file,
          id: (file as any)._fileId || `${file.name}-${file.size}-${index}`,
          progress: 100,
        }
        
        // Generate preview URL for image files
        if (file.type?.startsWith('image/')) {
          uploadedFile.previewUrl = URL.createObjectURL(file)
        }

        return uploadedFile
      }));

        // Remove duplicates based on ID
        const uniqueFiles = initialFiles.filter((file, index, self) =>
          index === self.findIndex(f => f.id === file.id)
        );

        logger.info('📸 [FileUpload] Setting uploaded files:', {
          count: uniqueFiles.length,
          files: uniqueFiles.map(f => ({
            id: f.id,
            name: f.actualName || f.file?.name,
            hasPreviewUrl: !!f.previewUrl,
            isFileMetadata: f.isFileMetadata
          }))
        });

        setUploadedFiles(uniqueFiles);
      };

      loadFilesWithPreviews().then(() => {
        logger.info('📸 [FileUpload] Finished loading file previews');
      });
    } else if (!value || value.length === 0) {
      // Clear previews tracking when value is cleared
      loadedPreviewsRef.current.clear()
      setUploadedFiles([])
    }
  }, [value])

  // Cleanup preview URLs when component unmounts
  useEffect(() => {
    return () => {
      uploadedFiles.forEach(file => {
        if (file.previewUrl) {
          URL.revokeObjectURL(file.previewUrl)
        }
      })
    }
  }, [])

  const handleFiles = (fileList: FileList) => {
    const newErrors: string[] = []
    const validFiles: File[] = []
    const newUploadedFiles: UploadedFile[] = []

    Array.from(fileList).forEach((file, index) => {
      // Check for duplicate files (same name and size)
      const isDuplicate = uploadedFiles.some(uploaded => 
        uploaded.file?.name === file.name && uploaded.file?.size === file.size
      )
      
      if (isDuplicate) {
        newErrors.push(`${file.name} is already attached.`)
        return
      }
      
      // Check file size
      if (file.size > maxSize) {
        newErrors.push(`${file.name} is too large. Maximum size is ${formatFileSize(maxSize)}.`)
        return
      }

      // Check file count
      if (uploadedFiles.length + validFiles.length >= maxFiles) {
        newErrors.push(`Maximum ${maxFiles} files allowed.`)
        return
      }

      validFiles.push(file)
      
      const uploadedFile: UploadedFile = {
        file,
        id: `${file.name}-${file.size}-${Date.now()}-${index}`, // More unique ID
        progress: 100, // For now, we'll set to 100% immediately
      }
      
      // Generate preview URL for image files
      if (file.type.startsWith('image/')) {
        uploadedFile.previewUrl = URL.createObjectURL(file)
      }
      
      newUploadedFiles.push(uploadedFile)
    })

    setErrors(newErrors)
    
    if (validFiles.length > 0) {
      const combinedFiles = [...uploadedFiles, ...newUploadedFiles]
      setUploadedFiles(combinedFiles)
      
      // Convert to FileList-like structure for onChange
      const dataTransfer = new DataTransfer()
      combinedFiles.forEach(({ file, isFileMetadata, isFileId }) => {
        // Only add real File objects to DataTransfer
        // Skip Blob objects created for display purposes
        // Check if it's a real file by checking for the slice method and other File properties
        const isRealFile = !isFileMetadata && !isFileId && 
          file && typeof file === 'object' && 
          typeof file.slice === 'function' &&
          'name' in file && 'size' in file && 'type' in file;
          
        if (isRealFile) {
          try {
            dataTransfer.items.add(file)
          } catch (error) {
            // If adding fails, it's not a real File object, skip it
            console.debug('Skipping non-File object in upload:', file.name || 'unknown')
          }
        }
      })
      onChange(dataTransfer.files)
    }
  }

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true)
    } else if (e.type === "dragleave") {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    
    if (disabled) return
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    logger.info('FileUpload: Input change event triggered', { filesCount: e.target.files?.length });
    if (e.target.files && e.target.files[0]) {
      handleFiles(e.target.files)
      // Reset the input to allow selecting the same file again if needed
      e.target.value = ''
    }
  }

  const removeFile = (fileId: string) => {
    const fileToRemove = uploadedFiles.find(f => f.id === fileId)
    if (fileToRemove?.previewUrl) {
      URL.revokeObjectURL(fileToRemove.previewUrl)
    }
    
    const updatedFiles = uploadedFiles.filter(f => f.id !== fileId)
    setUploadedFiles(updatedFiles)
    
    // Update onChange with remaining files
    const dataTransfer = new DataTransfer()
    updatedFiles.forEach(({ file }) => dataTransfer.items.add(file))
    onChange(dataTransfer.files)
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2)) } ${ sizes[i]}`
  }

  const isImageFile = (file: File): boolean => {
    return file.type.startsWith('image/')
  }

  const getFileIcon = (fileName: string, mimeType?: string) => {
    const extension = fileName.split('.').pop()?.toLowerCase()
    const type = mimeType?.toLowerCase() || ''

    // Images
    if (type.startsWith('image/')) {
      return ImageIcon
    }

    // Documents
    if (extension === 'doc' || extension === 'docx' ||
        type.includes('word') || type.includes('document')) {
      return FileText
    }

    if (extension === 'pdf' || type.includes('pdf')) {
      return FileText
    }

    if (extension === 'txt' || type.includes('text/plain')) {
      return FileText
    }

    // Spreadsheets
    if (extension === 'xls' || extension === 'xlsx' || extension === 'csv' ||
        type.includes('spreadsheet') || type.includes('excel')) {
      return FileSpreadsheet
    }

    // Presentations
    if (extension === 'ppt' || extension === 'pptx' ||
        type.includes('presentation') || type.includes('powerpoint')) {
      return Presentation
    }

    // Videos
    if (extension === 'mp4' || extension === 'mov' || extension === 'avi' || extension === 'mkv' ||
        type.startsWith('video/')) {
      return FileVideo
    }

    // Audio
    if (extension === 'mp3' || extension === 'wav' || extension === 'ogg' || extension === 'm4a' ||
        type.startsWith('audio/')) {
      return FileAudio
    }

    // Archives
    if (extension === 'zip' || extension === 'rar' || extension === '7z' || extension === 'tar' || extension === 'gz' ||
        type.includes('zip') || type.includes('compressed')) {
      return FileArchive
    }

    // Code files
    if (extension === 'js' || extension === 'ts' || extension === 'jsx' || extension === 'tsx' ||
        extension === 'py' || extension === 'java' || extension === 'cpp' || extension === 'c' ||
        extension === 'html' || extension === 'css' || extension === 'json' || extension === 'xml') {
      return FileCode
    }

    // Default
    return File
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Upload Area */}
      <div
        className={cn(
          "relative border-2 border-dashed rounded-lg p-6 transition-colors",
          dragActive ? "border-primary bg-primary/5" : "border-border",
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-primary/50",
          errors.length > 0 ? "border-red-500" : ""
        )}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          multiple={maxFiles > 1}
          onChange={handleInputChange}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          disabled={disabled}
          aria-label="Upload files"
        />
        
        <div className="flex flex-col items-center justify-center space-y-2 text-center">
          <Upload className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">{placeholder}</p>
            <p className="text-xs text-muted-foreground">
              Drag and drop files here or click to browse
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Max {maxFiles} files, {formatFileSize(maxSize)} each
            </p>
          </div>
        </div>
      </div>

      {/* Error Messages */}
      {errors.length > 0 && (
        <div className="space-y-1">
          {errors.map((error, index) => (
            <div key={index} className="flex items-center gap-2 text-sm text-red-600">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          ))}
        </div>
      )}

      {/* Uploaded Files List */}
      {!hideUploadedFiles && uploadedFiles.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Attached Files:</p>
          {uploadedFiles.map((uploadedFile) => (
            <div
              key={uploadedFile.id}
              className="flex items-center justify-between p-3 border rounded-lg bg-card"
            >
              <div className="flex items-center space-x-3 flex-1">
                {/* File Icon or Image Preview */}
                {(() => {
                  const fileName = uploadedFile.actualName || uploadedFile.file?.name || ''
                  const fileType = uploadedFile.actualType || uploadedFile.file?.type || ''
                  const FileIcon = getFileIcon(fileName, fileType)

                  if (uploadedFile.isFileId) {
                    return (
                      <div className="w-10 h-10 bg-muted rounded flex items-center justify-center">
                        <FileIcon className="w-5 h-5 text-muted-foreground" />
                      </div>
                    )
                  } else if ((fileType.startsWith('image/') || isImageFile(uploadedFile.file)) && uploadedFile.previewUrl) {
                    return (
                      <div className="w-10 h-10 rounded overflow-hidden flex-shrink-0">
                        <img
                          src={uploadedFile.previewUrl}
                          alt={fileName}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )
                  } else if (fileType.startsWith('image/') || uploadedFile.file?.type?.startsWith('image/')) {
                    return (
                      <div className="w-10 h-10 bg-muted rounded flex items-center justify-center">
                        <ImageIcon className="w-5 h-5 text-muted-foreground" />
                      </div>
                    )
                  } else {
                    return <FileIcon className="h-5 w-5 text-muted-foreground" />
                  }
                })()}
                
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {uploadedFile.isFileId ? 'File uploaded successfully' :
                     uploadedFile.actualName || uploadedFile.file.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {uploadedFile.isFileId ? `File ID: ${uploadedFile.id}` :
                     formatFileSize(uploadedFile.actualSize || uploadedFile.file.size)}
                  </p>
                </div>
              </div>
              
              {uploadedFile.progress < 100 && (
                <div className="w-20 mr-3">
                  <Progress value={uploadedFile.progress} className="h-2" />
                </div>
              )}
              
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  removeFile(uploadedFile.id)
                }}
                disabled={disabled}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
} 
