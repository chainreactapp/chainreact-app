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

interface GmailAttachmentFieldProps {
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

export function GmailAttachmentField({
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
}: GmailAttachmentFieldProps) {
  const searchParams = useSearchParams();
  const workflowIdFromUrl = searchParams.get('id'); // Get workflow ID from URL
  
  const [uploading, setUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<any>(null);
  const [fileInputKey, setFileInputKey] = useState(0); // For resetting file input

  // Load existing file info if value is present (only on initial mount)
  useEffect(() => {
    // Only set uploadedFile if we don't already have file info
    if (value && sourceType === "file" && !uploadedFile) {
      // Check if value is an object (file info) or string (nodeId)
      if (typeof value === 'object' && value.nodeId) {
        // File with full info
        setUploadedFile({
          nodeId: value.nodeId,
          fileName: value.fileName || parentValues?.attachmentFileName || "Uploaded file",
          fileSize: value.fileSize || parentValues?.attachmentFileSize,
          fileType: value.fileType || parentValues?.attachmentFileType,
          filePath: value.filePath,
          isTemporary: value.isTemporary,
          content: value.content,
          mimeType: value.mimeType
        });
      } else if (typeof value === "string") {
        // Just a nodeId string - check parentValues for metadata
        if (parentValues?.attachmentFileName) {
          setUploadedFile({ 
            nodeId: value, 
            fileName: parentValues.attachmentFileName,
            fileSize: parentValues.attachmentFileSize,
            fileType: parentValues.attachmentFileType
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
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }

    const file = files[0];
    
    // Check file size (25MB limit for Gmail)
    const MAX_SIZE = 25 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      alert(`File too large. Maximum size is 25MB.`);
      return;
    }

    // If there's already an uploaded file, remove it first to prevent orphaned files
    if (uploadedFile && uploadedFile.nodeId) {
      try {
        // PR-AUTH-5: cached auth header. Best-effort cleanup; ignore failures.
        const fileNodeId = uploadedFile.nodeId;
        let actualWorkflowId = workflowIdFromUrl || workflowId || '';
        if (!actualWorkflowId || actualWorkflowId === 'undefined' || actualWorkflowId === 'null' || actualWorkflowId === '') {
          actualWorkflowId = crypto.randomUUID();
        }

        await fetch(`/api/workflows/gmail/attachments/upload?nodeId=${fileNodeId}&workflowId=${actualWorkflowId}`, {
          method: 'DELETE',
          headers: {
            ...(await getAuthHeader()),
          },
        });
      } catch (error) {
        // Continue with upload even if cleanup failed
      }
    }

    setUploading(true);

    try {
      // PR-AUTH-5: cached auth header. Missing token → server returns 401 →
      // !response.ok branch surfaces the API's error message via alert().
      // Always use a proper UUID for the file storage, but keep the original nodeId for reference
      // The nodeId from the workflow (like "node-1757693755059-gk6c930g6") is not a valid UUID
      const fileStorageId = crypto.randomUUID();

      // Use workflow ID from URL first, then prop, then generate if needed
      let actualWorkflowId = workflowIdFromUrl || workflowId || '';
      if (!actualWorkflowId || actualWorkflowId === 'undefined' || actualWorkflowId === 'null' || actualWorkflowId === '') {
        // For new workflows that haven't been saved yet, generate a UUID
        actualWorkflowId = crypto.randomUUID();
      }

      // Upload file to our Gmail attachments API
      const formData = new FormData();
      formData.append('file', file);
      formData.append('workflowId', actualWorkflowId);
      formData.append('nodeId', fileStorageId);

      const response = await fetch('/api/workflows/gmail/attachments/upload', {
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
      
      // Store the complete file information for Gmail attachments
      const fileInfo = {
        nodeId: data.file.nodeId || fileStorageId,
        fileName: data.file.fileName || file.name,
        fileSize: data.file.fileSize || file.size,
        fileType: data.file.fileType || file.type,
        filePath: data.file.filePath,
        isTemporary: data.file.isTemporary || false,
        content: data.file.content, // Base64 content for immediate use
        mimeType: data.file.mimeType || file.type || 'application/octet-stream'
      };
      
      // Pass the complete file info to the parent
      onChange(fileInfo);
      
      // Update local state to show uploaded file
      setUploadedFile(fileInfo);

      // Store file metadata in parent values for persistence
      if (setFieldValue) {
        setFieldValue('attachmentFileName', file.name);
        setFieldValue('attachmentFileSize', file.size);
        setFieldValue('attachmentFileType', file.type);
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
    if (!uploadedFile || !uploadedFile.nodeId) return;

    try {
      // Get the current session for auth token
      // PR-AUTH-5: cached auth header.
      const fileNodeId = uploadedFile.nodeId;

      // Use workflow ID from URL first, then prop, then generate if needed
      let actualWorkflowId = workflowIdFromUrl || workflowId || '';
      if (!actualWorkflowId || actualWorkflowId === 'undefined' || actualWorkflowId === 'null' || actualWorkflowId === '') {
        actualWorkflowId = crypto.randomUUID();
      }

      // Delete the file from storage
      await fetch(`/api/workflows/gmail/attachments/upload?nodeId=${fileNodeId}&workflowId=${actualWorkflowId}`, {
        method: 'DELETE',
        headers: {
          ...(await getAuthHeader()),
        },
      });

      // Clear the value
      onChange('');
      setUploadedFile(null);
      
      // Also clear the metadata fields
      if (setFieldValue) {
        setFieldValue('attachmentFileName', '');
        setFieldValue('attachmentFileSize', '');
        setFieldValue('attachmentFileType', '');
      }
      
      // Reset file input
      setFileInputKey(prev => prev + 1);

    } catch (error) {
      logger.error('Failed to remove file:', error);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Math.round(bytes / Math.pow(k, i) * 100) / 100 } ${ sizes[i]}`;
  };

  // Generate a unique ID for the file input
  // Use a timestamp-based ID to avoid issues with non-standard node IDs
  const fileInputId = `gmail-file-input-${Date.now()}`;
  
  return (
    <div className="space-y-2">
      <Label htmlFor={fileInputId} className="flex items-center gap-2">
        <Upload className="h-4 w-4" />
        {field.label || "Attachments"}
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
            accept={field.accept || "*/*"}
            onChange={handleFileUpload}
            disabled={uploading}
            className="hidden"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const fileInput = document.getElementById(fileInputId);
              if (fileInput) {
                (fileInput as HTMLInputElement).click();
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