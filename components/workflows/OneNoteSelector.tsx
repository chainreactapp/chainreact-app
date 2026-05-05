import React, { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { InfoIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/use-auth';
import { getAuthHeader } from '@/lib/auth/getAuthHeader';

import { logger } from '@/lib/utils/logger'

interface OneNoteItem {
  id: string;
  name: string;
  value: string;
}

interface OneNoteSelectorProps {
  integrationId: string;
  value?: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  type: 'notebook' | 'section' | 'page';
  dependsOn?: {
    notebookId?: string;
    sectionId?: string;
  };
  required?: boolean;
}

export function OneNoteSelector({
  integrationId,
  value,
  onChange,
  label,
  placeholder = 'Select...',
  type,
  dependsOn,
  required = false,
}: OneNoteSelectorProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [items, setItems] = useState<OneNoteItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { user, isAuthenticated } = useAuth();

  // PR-AUTH-5: removed the local-token-state workaround. Auth header comes
  // from the cached getAuthHeader() per request — no separate getSession()
  // round-trip on mount.

  useEffect(() => {
    async function loadData() {
      if (!isAuthenticated || !user) {
        setIsLoading(false);
        setError("Authentication required");
        return;
      }
      
      setIsLoading(true);
      setError(null);
      
      try {
        let dataType;
        let options = {};
        
        if (type === 'notebook') {
          dataType = 'onenote_notebooks';
        } else if (type === 'section') {
          dataType = 'onenote_sections';
          if (dependsOn?.notebookId) {
            options = { notebookId: dependsOn.notebookId };
          } else {
            setItems([]);
            setIsLoading(false);
            return;
          }
        } else if (type === 'page') {
          dataType = 'onenote_pages';
          if (dependsOn?.sectionId) {
            options = { sectionId: dependsOn.sectionId };
          } else {
            setItems([]);
            setIsLoading(false);
            return;
          }
        }
        
        // PR-AUTH-5: cached token; falls back to {} if missing → server 401.
        const response = await fetch('/api/integrations/fetch-user-data', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(await getAuthHeader())
          },
          body: JSON.stringify({
            integrationId,
            dataType,
            options
          })
        });
        
        if (!response.ok) {
          throw new Error(`API error: ${response.status} ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (result.error) {
          setError(result.error.message || 'Failed to load data');
          setItems([]);
        } else {
          // Handle the data based on the response format
          const itemsData = result.data || [];
          
          // Map the items to a consistent format
          const formattedItems: OneNoteItem[] = itemsData.map((item: any) => ({
            id: item.id,
            name: item.displayName || item.title || item.name || 'Untitled',
            value: item.id
          }));
          
          setItems(formattedItems);
          
          // If the current value is not in the items list, reset it
          if (value && !formattedItems.some((item: OneNoteItem) => item.id === value)) {
            onChange('');
          }
        }
      } catch (err: any) {
        logger.error(`Error loading ${type}:`, err);
        setError(err.message || 'An error occurred');
        setItems([]);
      } finally {
        setIsLoading(false);
      }
    }
    
    loadData();
  }, [integrationId, type, dependsOn?.notebookId, dependsOn?.sectionId, value, onChange, user, isAuthenticated]);
  
  if (isLoading) {
    return (
      <div className="space-y-2">
        {label && <Label>{label}</Label>}
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="space-y-2">
        {label && <Label>{label}</Label>}
        <Alert variant="destructive">
          <InfoIcon className="h-4 w-4" />
          <AlertTitle>OneNote API Limitation</AlertTitle>
          <AlertDescription>
            {error}
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  
  if (items.length === 0) {
    return (
      <div className="space-y-2">
        {label && <Label>{label}</Label>}
        <Select disabled value={value ?? ""}>
          <SelectTrigger>
            <SelectValue placeholder={`No ${type}s available`} />
          </SelectTrigger>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          {type === 'section' ? 'Please select a notebook first' : 
           type === 'page' ? 'Please select a section first' : 
           'No notebooks found. If you\'re using a personal Microsoft account, some features may be limited.'}
        </p>
      </div>
    );
  }
  
  return (
    <div className="space-y-2">
      {label && <Label>{required ? `${label} *` : label}</Label>}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {items.map((item: OneNoteItem) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
} 
