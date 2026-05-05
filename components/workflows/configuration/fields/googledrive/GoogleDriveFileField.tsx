"use client"

import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Upload, Link, Database, X, File } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAuthHeader } from "@/lib/auth/getAuthHeader";
import VariablePicker from "../../../VariablePicker";

import { logger } from '@/lib/utils/logger'

interface GoogleDriveFileFieldProps {
  field: any;
  value: any;
  onChange: (value: any) => void;
  error?: string;
  sourceType?: string;
  workflowId?: string;
  nodeId?: string;
  workflowData?: { nodes: any[]; edges: any[] };
  currentNodeId?: string;
  parentValues?: Record<string, any>;
  setFieldValue?: (field: string, value: any) => void;
}

export function GoogleDriveFileField({
  field,
  value,
  onChange,
  error,
  sourceType = "file",
  workflowId,
  nodeId,
  workflowData,
  currentNodeId,
  parentValues,
  setFieldValue,
}: GoogleDriveFileFieldProps) {
  const searchParams = useSearchParams();
  const workflowIdFromUrl = searchParams.get('id'); // Get workflow ID from URL
  
  const [uploading, setUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<any>(null);
  const [fileInputKey, setFileInputKey] = useState(0); // For resetting file input

  // Load existing file info if value is a node ID (only on initial mount)
  useEffect(() => {
    // Only set uploadedFile if we don't already have file info
    if (value && sourceType === "file" && !uploadedFile) {
      // Check if value is an object (temporary file) or string (permanent file)
      if (typeof value === 'object' && value.nodeId) {
        // Temporary file with full info
        setUploadedFile({
          nodeId: value.nodeId,
          fileName: parentValues?.fileName || "Uploaded file",
          fileSize: parentValues?.fileSize,
          fileType: parentValues?.fileType,
          filePath: value.filePath,
          isTemporary: value.isTemporary
        });
      } else if (typeof value === "string") {
        // Permanent file with node ID
        // Check if we have fileName in parentValues which would indicate a recently uploaded file
        if (parentValues?.fileName) {
          setUploadedFile({ 
            nodeId: value, 
            fileName: parentValues.fileName,
            fileSize: parentValues.fileSize,
            fileType: parentValues.fileType
          });
        } else {
          // Fallback for existing files without detailed info
          setUploadedFile({ nodeId: value, fileName: "Uploaded file" });
        }
      }
    } else if (!value && uploadedFile) {
      // Clear uploadedFile if value is cleared
      setUploadedFile(null);
    }
  }, [value, sourceType]); // Removed uploadedFile from dependencies to prevent loops

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    logger.info('🎯 [GoogleDriveFileField] handleFileUpload triggered');
    const files = event.target.files;
    logger.info('📁 [GoogleDriveFileField] Files selected:', files);
    if (!files || files.length === 0) {
      logger.info('⚠️ [GoogleDriveFileField] No files selected');
      return;
    }

    const file = files[0];
    logger.info('📄 [GoogleDriveFileField] File details:', {
      name: file.name,
      size: file.size,
      type: file.type,
      setFieldValue: !!setFieldValue,
      parentValues,
      workflowId,
      nodeId,
      currentNodeId
    });
    
    // Check file size (25MB limit)
    const MAX_SIZE = 25 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      alert(`File too large. Maximum size is 25MB.`);
      return;
    }

    // If there's already an uploaded file, remove it first to prevent orphaned files
    if (uploadedFile) {
      logger.info('🔄 [GoogleDriveFileField] Removing previous file before uploading new one');
      try {
        // PR-AUTH-5: cached auth header. Best-effort cleanup; ignore failures.
        const fileNodeId = uploadedFile.nodeId || nodeId || currentNodeId || crypto.randomUUID();
        let actualWorkflowId = workflowIdFromUrl || workflowId || '';
        if (!actualWorkflowId || actualWorkflowId === 'undefined' || actualWorkflowId === 'null' || actualWorkflowId === '') {
          actualWorkflowId = crypto.randomUUID();
        }

        await fetch(`/api/workflows/files/upload?nodeId=${fileNodeId}&workflowId=${actualWorkflowId}`, {
          method: 'DELETE',
          headers: {
            ...(await getAuthHeader()),
          },
        });
      } catch (error) {
        logger.warn('⚠️ [GoogleDriveFileField] Failed to remove previous file:', error);
        // Continue with upload even if cleanup failed
      }
    }

    setUploading(true);

    try {
      // PR-AUTH-5: cached auth header. Missing token → server returns 401 →
      // !response.ok branch surfaces the error via alert().

      // Generate a proper node ID if we have a pending action
      let actualNodeId = nodeId || currentNodeId || '';
      if (actualNodeId === 'pending-action' || actualNodeId.startsWith('pending-') || !actualNodeId) {
        // Generate a UUID for pending nodes
        actualNodeId = crypto.randomUUID();
        logger.info('📝 [GoogleDriveFileField] Generated UUID for pending node:', actualNodeId);
      }
      
      // Use workflow ID from URL first, then prop, then generate if needed
      let actualWorkflowId = workflowIdFromUrl || workflowId || '';
      if (!actualWorkflowId || actualWorkflowId === 'undefined' || actualWorkflowId === 'null' || actualWorkflowId === '') {
        // For new workflows that haven't been saved yet, generate a UUID
        actualWorkflowId = crypto.randomUUID();
        logger.info('📝 [GoogleDriveFileField] Generated UUID for workflow:', actualWorkflowId);
      } else {
        logger.info('📝 [GoogleDriveFileField] Using workflow ID:', actualWorkflowId, 'from:', workflowIdFromUrl ? 'URL' : 'prop');
      }
      
      logger.info('📤 [GoogleDriveFileField] Uploading with IDs:', {
        actualNodeId,
        actualWorkflowId,
        originalNodeId: nodeId,
        originalWorkflowId: workflowId,
        currentNodeId
      });
      
      // Upload file to our API
      const formData = new FormData();
      formData.append('file', file);
      formData.append('workflowId', actualWorkflowId);
      formData.append('nodeId', actualNodeId);

      const response = await fetch('/api/workflows/files/upload', {
        method: 'POST',
        headers: {
          ...(await getAuthHeader()),
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to upload file');
      }

      const data = await response.json();
      logger.info('✅ [GoogleDriveFileField] Upload successful:', data);
      
      // Store the actual node ID as the value (since we use node_id as file identifier)
      // For temporary files, we store the file path as well
      if (data.isTemporary) {
        // For temporary files, store both the nodeId and filePath
        onChange({
          nodeId: actualNodeId,
          filePath: data.filePath,
          isTemporary: true
        });
      } else {
        // For permanent files, just store the nodeId
        onChange(actualNodeId);
      }
      
      // Update local state to show uploaded file with actual details
      const fileInfo = {
        nodeId: actualNodeId,
        fileName: data.fileName || file.name,
        fileSize: data.fileSize || file.size,
        fileType: data.fileType || file.type,
        filePath: data.filePath,
        isTemporary: data.isTemporary || false
      };
      
      setUploadedFile(fileInfo);
      logger.info('📝 [GoogleDriveFileField] Updated uploadedFile state:', fileInfo);

      // Also update the fileName field if it exists
      logger.info('🔄 [GoogleDriveFileField] Attempting to update fileName field:', {
        hasSetFieldValue: !!setFieldValue,
        currentFileName: parentValues?.fileName,
        newFileName: file.name
      });
      
      // Always update fileName field when a new file is uploaded
      if (setFieldValue) {
        logger.info('🚀 [GoogleDriveFileField] Calling setFieldValue with fileName:', file.name);
        setFieldValue('fileName', file.name);
        // Also store file metadata in parent values for persistence
        setFieldValue('fileSize', file.size);
        setFieldValue('fileType', file.type);
      } else {
        logger.info('⚠️ [GoogleDriveFileField] No setFieldValue function available');
      }
      
      // Reset the file input to allow selecting the same file again
      setFileInputKey(prev => prev + 1);

    } catch (error: any) {
      logger.error('File upload error:', error);
      alert(error.message || 'Failed to upload file');
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveFile = async () => {
    if (!uploadedFile) return;

    try {
      // PR-AUTH-5: cached auth header.
      const fileNodeId = uploadedFile.nodeId || nodeId || currentNodeId || crypto.randomUUID();

      // Use workflow ID from URL first, then prop, then generate if needed
      let actualWorkflowId = workflowIdFromUrl || workflowId || '';
      if (!actualWorkflowId || actualWorkflowId === 'undefined' || actualWorkflowId === 'null' || actualWorkflowId === '') {
        actualWorkflowId = crypto.randomUUID();
      }

      // Delete the file from storage
      await fetch(`/api/workflows/files/upload?nodeId=${fileNodeId}&workflowId=${actualWorkflowId}`, {
        method: 'DELETE',
        headers: {
          ...(await getAuthHeader()),
        },
      });

      // Clear the value
      onChange('');
      setUploadedFile(null);
      
      // Also clear the fileName field
      if (setFieldValue) {
        setFieldValue('fileName', '');
      }
      
      // Reset file input
      setFileInputKey(prev => prev + 1);

    } catch (error) {
      logger.error('Failed to remove file:', error);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Math.round(bytes / Math.pow(k, i) * 100) / 100 } ${ sizes[i]}`;
  };

  // Render based on sourceType
  if (field.name === "fileUrl" && sourceType === "url") {
    return (
      <div className="space-y-2">
        <Label htmlFor={field.name} className="flex items-center gap-2">
          <Link className="h-4 w-4" />
          {field.label || "File URL"}
        </Label>
        <Input
          id={field.name}
          type="url"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || "https://example.com/file.pdf"}
          className={cn(error && "border-red-500")}
        />
        {field.description && (
          <p className="text-xs text-muted-foreground">{field.description}</p>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    );
  }

  if (field.name === "fileFromNode" && sourceType === "node") {
    return (
      <div className="space-y-2">
        <Label htmlFor={field.name} className="flex items-center gap-2">
          <Database className="h-4 w-4" />
          {field.label || "File Variable"}
        </Label>
        <div className="flex gap-2">
          <Input
            id={field.name}
            type="text"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder || "{{node-id.file}}"}
            className={cn(error && "border-red-500")}
          />
          <VariablePicker
            workflowData={workflowData}
            currentNodeId={currentNodeId}
            onVariableSelect={(variable) => onChange(variable)}
            fieldType="file"
            trigger={
              <Button 
                type="button"
                size="sm" 
                variant="outline"
                className="px-3"
                title="Insert variable"
              >
                <Database className="h-4 w-4" />
              </Button>
            }
          />
        </div>
        {field.description && (
          <p className="text-xs text-muted-foreground">{field.description}</p>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    );
  }

  if (field.name === "uploadedFiles" && sourceType === "file") {
    // Generate a unique ID for the file input (handle pending actions)
    let idForInput = nodeId || currentNodeId || 'default';
    if (idForInput === 'pending-action' || idForInput.startsWith('pending-')) {
      idForInput = `temp-${ Date.now()}`;
    }
    const fileInputId = `file-input-${idForInput}`;
    
    logger.info('📌 [GoogleDriveFileField] Rendering file upload field:', {
      fieldName: field.name,
      fileInputId,
      sourceType,
      hasUploadedFile: !!uploadedFile,
      nodeId,
      currentNodeId
    });
    
    return (
      <div className="space-y-2">
        <Label htmlFor={fileInputId} className="flex items-center gap-2">
          <Upload className="h-4 w-4" />
          {field.label || "Upload Files"}
        </Label>
        
        {uploadedFile ? (
          <div className="border rounded-lg p-3 bg-muted/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <File className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{uploadedFile.fileName}</p>
                  {uploadedFile.fileSize && (
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(uploadedFile.fileSize)}
                    </p>
                  )}
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={handleRemoveFile}
                className="h-8 w-8 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <input
              key={fileInputKey}
              id={fileInputId}
              type="file"
              accept={field.accept}
              onChange={handleFileUpload}
              disabled={uploading}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                logger.info('🖱️ [GoogleDriveFileField] Button clicked, attempting to trigger file input:', fileInputId);
                const fileInput = document.getElementById(fileInputId);
                logger.info('🔍 [GoogleDriveFileField] File input element found:', !!fileInput);
                if (fileInput) {
                  (fileInput as HTMLInputElement).click();
                } else {
                  logger.error('❌ [GoogleDriveFileField] File input element not found!');
                }
              }}
              disabled={uploading}
              className="w-full"
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Choose File
                </>
              )}
            </Button>
          </div>
        )}

        {field.description && (
          <p className="text-xs text-muted-foreground">{field.description}</p>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    );
  }

  // Default: return null if field doesn't match current sourceType
  return null;
}