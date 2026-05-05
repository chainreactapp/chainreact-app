export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_step_up_sessions: {
        Row: {
          expires_at: string
          id: string
          ip_address: unknown
          method: string
          user_agent: string | null
          user_id: string
          verified_at: string
        }
        Insert: {
          expires_at?: string
          id?: string
          ip_address?: unknown
          method: string
          user_agent?: string | null
          user_id: string
          verified_at?: string
        }
        Update: {
          expires_at?: string
          id?: string
          ip_address?: unknown
          method?: string
          user_agent?: string | null
          user_id?: string
          verified_at?: string
        }
        Relationships: []
      }
      agent_chat_messages: {
        Row: {
          content: string
          created_at: string
          flow_id: string
          id: string
          metadata: Json | null
          role: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          flow_id: string
          id?: string
          metadata?: Json | null
          role: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          flow_id?: string
          id?: string
          metadata?: Json | null
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_chat_messages_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_eval_events: {
        Row: {
          agent_version: string
          category: string
          conversation_id: string
          created_at: string
          event_name: string
          flow_id: string | null
          id: string
          llm_model: string | null
          metadata: Json
          planner_path: string | null
          prompt_type: string | null
          session_id: string
          session_outcome: string | null
          time_since_last_turn_ms: number | null
          turn_number: number
          user_id: string
        }
        Insert: {
          agent_version?: string
          category: string
          conversation_id: string
          created_at?: string
          event_name: string
          flow_id?: string | null
          id?: string
          llm_model?: string | null
          metadata?: Json
          planner_path?: string | null
          prompt_type?: string | null
          session_id: string
          session_outcome?: string | null
          time_since_last_turn_ms?: number | null
          turn_number?: number
          user_id: string
        }
        Update: {
          agent_version?: string
          category?: string
          conversation_id?: string
          created_at?: string
          event_name?: string
          flow_id?: string | null
          id?: string
          llm_model?: string | null
          metadata?: Json
          planner_path?: string | null
          prompt_type?: string | null
          session_id?: string
          session_outcome?: string | null
          time_since_last_turn_ms?: number | null
          turn_number?: number
          user_id?: string
        }
        Relationships: []
      }
      ai_assistant_waitlist: {
        Row: {
          created_at: string | null
          email: string
          id: string
          status: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          status?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          status?: string | null
        }
        Relationships: []
      }
      ai_chat_history: {
        Row: {
          context: Json | null
          created_at: string | null
          id: string
          message: string
          response: string
          user_id: string | null
        }
        Insert: {
          context?: Json | null
          created_at?: string | null
          id?: string
          message: string
          response: string
          user_id?: string | null
        }
        Update: {
          context?: Json | null
          created_at?: string | null
          id?: string
          message?: string
          response?: string
          user_id?: string | null
        }
        Relationships: []
      }
      ai_conversations: {
        Row: {
          created_at: string | null
          id: string
          messages: Json | null
          metadata: Json | null
          title: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          messages?: Json | null
          metadata?: Json | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          messages?: Json | null
          metadata?: Json | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      ai_cost_logs: {
        Row: {
          cost_usd: number | null
          created_at: string | null
          execution_id: string | null
          id: string
          input_tokens: number | null
          metadata: Json | null
          model: string
          output_tokens: number | null
          total_tokens: number | null
          user_id: string | null
          workflow_id: string | null
        }
        Insert: {
          cost_usd?: number | null
          created_at?: string | null
          execution_id?: string | null
          id?: string
          input_tokens?: number | null
          metadata?: Json | null
          model: string
          output_tokens?: number | null
          total_tokens?: number | null
          user_id?: string | null
          workflow_id?: string | null
        }
        Update: {
          cost_usd?: number | null
          created_at?: string | null
          execution_id?: string | null
          id?: string
          input_tokens?: number | null
          metadata?: Json | null
          model?: string
          output_tokens?: number | null
          total_tokens?: number | null
          user_id?: string | null
          workflow_id?: string | null
        }
        Relationships: []
      }
      ai_field_resolutions: {
        Row: {
          created_at: string | null
          execution_id: string | null
          field_name: string
          id: string
          metadata: Json | null
          resolved_value: string | null
          workflow_id: string
        }
        Insert: {
          created_at?: string | null
          execution_id?: string | null
          field_name: string
          id?: string
          metadata?: Json | null
          resolved_value?: string | null
          workflow_id: string
        }
        Update: {
          created_at?: string | null
          execution_id?: string | null
          field_name?: string
          id?: string
          metadata?: Json | null
          resolved_value?: string | null
          workflow_id?: string
        }
        Relationships: []
      }
      ai_field_resolutions_detailed: {
        Row: {
          created_at: string | null
          execution_id: string | null
          field_name: string
          id: string
          prompt: string | null
          response: string | null
          tokens_used: number | null
          workflow_id: string
        }
        Insert: {
          created_at?: string | null
          execution_id?: string | null
          field_name: string
          id?: string
          prompt?: string | null
          response?: string | null
          tokens_used?: number | null
          workflow_id: string
        }
        Update: {
          created_at?: string | null
          execution_id?: string | null
          field_name?: string
          id?: string
          prompt?: string | null
          response?: string | null
          tokens_used?: number | null
          workflow_id?: string
        }
        Relationships: []
      }
      ai_memory: {
        Row: {
          content: string | null
          created_at: string | null
          id: string
          memory_type: string
          metadata: Json | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          id?: string
          memory_type: string
          metadata?: Json | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string | null
          id?: string
          memory_type?: string
          metadata?: Json | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      ai_routing_decisions: {
        Row: {
          created_at: string | null
          decision: string | null
          execution_id: string | null
          id: string
          metadata: Json | null
          workflow_id: string
        }
        Insert: {
          created_at?: string | null
          decision?: string | null
          execution_id?: string | null
          id?: string
          metadata?: Json | null
          workflow_id: string
        }
        Update: {
          created_at?: string | null
          decision?: string | null
          execution_id?: string | null
          id?: string
          metadata?: Json | null
          workflow_id?: string
        }
        Relationships: []
      }
      ai_usage_logs: {
        Row: {
          action: string
          cost_usd: number | null
          created_at: string | null
          id: string
          metadata: Json | null
          tokens_used: number | null
          user_id: string | null
        }
        Insert: {
          action: string
          cost_usd?: number | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Update: {
          action?: string
          cost_usd?: number | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      ai_usage_stats: {
        Row: {
          created_at: string | null
          date: string
          id: string
          total_cost_usd: number | null
          total_requests: number | null
          total_tokens: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          date: string
          id?: string
          total_cost_usd?: number | null
          total_requests?: number | null
          total_tokens?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          date?: string
          id?: string
          total_cost_usd?: number | null
          total_requests?: number | null
          total_tokens?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      ai_user_budgets: {
        Row: {
          created_at: string | null
          current_spend_usd: number | null
          id: string
          monthly_limit_usd: number | null
          reset_at: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          current_spend_usd?: number | null
          id?: string
          monthly_limit_usd?: number | null
          reset_at?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          current_spend_usd?: number | null
          id?: string
          monthly_limit_usd?: number | null
          reset_at?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      ai_workflow_cost_logs: {
        Row: {
          breakdown: Json | null
          created_at: string | null
          flow_id: string
          id: string
          node_count: number
          planning_method: string
          tasks_used: number
          user_id: string
        }
        Insert: {
          breakdown?: Json | null
          created_at?: string | null
          flow_id: string
          id?: string
          node_count?: number
          planning_method?: string
          tasks_used?: number
          user_id: string
        }
        Update: {
          breakdown?: Json | null
          created_at?: string | null
          flow_id?: string
          id?: string
          node_count?: number
          planning_method?: string
          tasks_used?: number
          user_id?: string
        }
        Relationships: []
      }
      ai_workflow_generations: {
        Row: {
          confidence_score: number | null
          created_at: string | null
          feedback_rating: number | null
          feedback_text: string | null
          generated_workflow: Json
          id: string
          organization_id: string | null
          prompt: string
          status: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string | null
          feedback_rating?: number | null
          feedback_text?: string | null
          generated_workflow: Json
          id?: string
          organization_id?: string | null
          prompt: string
          status?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          confidence_score?: number | null
          created_at?: string | null
          feedback_rating?: number | null
          feedback_text?: string | null
          generated_workflow?: Json
          id?: string
          organization_id?: string | null
          prompt?: string
          status?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_workflow_generations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      airtable_webhooks: {
        Row: {
          base_id: string
          created_at: string | null
          expiration_time: string | null
          id: string
          integration_id: string | null
          is_active: boolean | null
          last_notification_time: string | null
          metadata: Json | null
          specification: Json | null
          table_id: string | null
          updated_at: string | null
          webhook_id: string
          webhook_url: string
        }
        Insert: {
          base_id: string
          created_at?: string | null
          expiration_time?: string | null
          id?: string
          integration_id?: string | null
          is_active?: boolean | null
          last_notification_time?: string | null
          metadata?: Json | null
          specification?: Json | null
          table_id?: string | null
          updated_at?: string | null
          webhook_id: string
          webhook_url: string
        }
        Update: {
          base_id?: string
          created_at?: string | null
          expiration_time?: string | null
          id?: string
          integration_id?: string | null
          is_active?: boolean | null
          last_notification_time?: string | null
          metadata?: Json | null
          specification?: Json | null
          table_id?: string | null
          updated_at?: string | null
          webhook_id?: string
          webhook_url?: string
        }
        Relationships: []
      }
      analytics_dashboards: {
        Row: {
          created_at: string | null
          id: string
          layout: Json
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          layout?: Json
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          layout?: Json
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      analytics_metrics: {
        Row: {
          created_at: string | null
          dimensions: Json | null
          id: string
          metric_name: string
          metric_type: string
          organization_id: string | null
          timestamp: string
          user_id: string
          value: number
        }
        Insert: {
          created_at?: string | null
          dimensions?: Json | null
          id?: string
          metric_name: string
          metric_type: string
          organization_id?: string | null
          timestamp: string
          user_id: string
          value: number
        }
        Update: {
          created_at?: string | null
          dimensions?: Json | null
          id?: string
          metric_name?: string
          metric_type?: string
          organization_id?: string | null
          timestamp?: string
          user_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "analytics_metrics_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_widget_cache: {
        Row: {
          data: Json
          id: string
          refreshed_at: string | null
          widget_id: string
        }
        Insert: {
          data?: Json
          id?: string
          refreshed_at?: string | null
          widget_id: string
        }
        Update: {
          data?: Json
          id?: string
          refreshed_at?: string | null
          widget_id?: string
        }
        Relationships: []
      }
      analytics_widgets: {
        Row: {
          config: Json | null
          created_at: string | null
          id: string
          schedule: string | null
          title: string
          type: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          config?: Json | null
          created_at?: string | null
          id: string
          schedule?: string | null
          title: string
          type: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          config?: Json | null
          created_at?: string | null
          id?: string
          schedule?: string | null
          title?: string
          type?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          organization_id: string | null
          scopes: string[]
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          organization_id?: string | null
          scopes: string[]
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          organization_id?: string | null
          scopes?: string[]
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string | null
          details: Json | null
          id: string
          ip_address: string | null
          resource_id: string | null
          resource_type: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          details?: Json | null
          id?: string
          ip_address?: string | null
          resource_id?: string | null
          resource_type?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          details?: Json | null
          id?: string
          ip_address?: string | null
          resource_id?: string | null
          resource_type?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      backup_recovery_logs: {
        Row: {
          backup_type: string
          checksum: string | null
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          file_path: string | null
          file_size: number | null
          id: string
          operation_type: string
          organization_id: string | null
          started_at: string
          status: string
        }
        Insert: {
          backup_type: string
          checksum?: string | null
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          operation_type: string
          organization_id?: string | null
          started_at: string
          status: string
        }
        Update: {
          backup_type?: string
          checksum?: string | null
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          operation_type?: string
          organization_id?: string | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "backup_recovery_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      beta_tester_activity: {
        Row: {
          action: string
          beta_tester_id: string | null
          created_at: string | null
          details: Json | null
          id: string
        }
        Insert: {
          action: string
          beta_tester_id?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string
        }
        Update: {
          action?: string
          beta_tester_id?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "beta_tester_activity_beta_tester_id_fkey"
            columns: ["beta_tester_id"]
            isOneToOne: false
            referencedRelation: "beta_testers"
            referencedColumns: ["id"]
          },
        ]
      }
      beta_tester_feedback: {
        Row: {
          beta_tester_id: string | null
          created_at: string | null
          feedback_text: string | null
          id: string
          metadata: Json | null
          rating: number | null
        }
        Insert: {
          beta_tester_id?: string | null
          created_at?: string | null
          feedback_text?: string | null
          id?: string
          metadata?: Json | null
          rating?: number | null
        }
        Update: {
          beta_tester_id?: string | null
          created_at?: string | null
          feedback_text?: string | null
          id?: string
          metadata?: Json | null
          rating?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "beta_tester_feedback_beta_tester_id_fkey"
            columns: ["beta_tester_id"]
            isOneToOne: false
            referencedRelation: "beta_testers"
            referencedColumns: ["id"]
          },
        ]
      }
      beta_testers: {
        Row: {
          accepted_at: string | null
          created_at: string | null
          email: string
          id: string
          invited_at: string | null
          metadata: Json | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string | null
          email: string
          id?: string
          invited_at?: string | null
          metadata?: Json | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          created_at?: string | null
          email?: string
          id?: string
          invited_at?: string | null
          metadata?: Json | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      browser_automation_logs: {
        Row: {
          created_at: string | null
          duration_seconds: number
          execution_id: string | null
          had_dynamic_content: boolean | null
          had_screenshot: boolean | null
          id: string
          url: string | null
          user_id: string
          workflow_id: string | null
        }
        Insert: {
          created_at?: string | null
          duration_seconds: number
          execution_id?: string | null
          had_dynamic_content?: boolean | null
          had_screenshot?: boolean | null
          id?: string
          url?: string | null
          user_id: string
          workflow_id?: string | null
        }
        Update: {
          created_at?: string | null
          duration_seconds?: number
          execution_id?: string | null
          had_dynamic_content?: boolean | null
          had_screenshot?: boolean | null
          id?: string
          url?: string | null
          user_id?: string
          workflow_id?: string | null
        }
        Relationships: []
      }
      business_context: {
        Row: {
          category: string
          created_at: string | null
          id: string
          key: string
          last_used_at: string | null
          locked: boolean | null
          organization_id: string | null
          relevance_tags: string[] | null
          scope: string
          source: string
          updated_at: string | null
          usage_count: number | null
          user_id: string
          value: string
        }
        Insert: {
          category: string
          created_at?: string | null
          id?: string
          key: string
          last_used_at?: string | null
          locked?: boolean | null
          organization_id?: string | null
          relevance_tags?: string[] | null
          scope?: string
          source?: string
          updated_at?: string | null
          usage_count?: number | null
          user_id: string
          value: string
        }
        Update: {
          category?: string
          created_at?: string | null
          id?: string
          key?: string
          last_used_at?: string | null
          locked?: boolean | null
          organization_id?: string | null
          relevance_tags?: string[] | null
          scope?: string
          source?: string
          updated_at?: string | null
          usage_count?: number | null
          user_id?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_context_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      collaboration_sessions: {
        Row: {
          created_at: string | null
          cursor_position: Json | null
          id: string
          is_active: boolean | null
          last_activity: string | null
          selected_nodes: string[] | null
          session_token: string
          user_id: string
          workflow_id: string
        }
        Insert: {
          created_at?: string | null
          cursor_position?: Json | null
          id?: string
          is_active?: boolean | null
          last_activity?: string | null
          selected_nodes?: string[] | null
          session_token: string
          user_id: string
          workflow_id: string
        }
        Update: {
          created_at?: string | null
          cursor_position?: Json | null
          id?: string
          is_active?: boolean | null
          last_activity?: string | null
          selected_nodes?: string[] | null
          session_token?: string
          user_id?: string
          workflow_id?: string
        }
        Relationships: []
      }
      compliance_audit_logs: {
        Row: {
          action: string
          compliance_tags: string[] | null
          created_at: string | null
          geolocation: Json | null
          id: string
          ip_address: unknown
          new_values: Json | null
          old_values: Json | null
          organization_id: string | null
          resource_id: string | null
          resource_type: string
          retention_until: string | null
          risk_score: number | null
          session_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          compliance_tags?: string[] | null
          created_at?: string | null
          geolocation?: Json | null
          id?: string
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          organization_id?: string | null
          resource_id?: string | null
          resource_type: string
          retention_until?: string | null
          risk_score?: number | null
          session_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          compliance_tags?: string[] | null
          created_at?: string | null
          geolocation?: Json | null
          id?: string
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          organization_id?: string | null
          resource_id?: string | null
          resource_type?: string
          retention_until?: string | null
          risk_score?: number | null
          session_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compliance_audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_api_connectors: {
        Row: {
          api_type: string
          authentication: Json
          base_url: string
          created_at: string | null
          description: string | null
          headers: Json | null
          id: string
          is_active: boolean | null
          name: string
          organization_id: string
          rate_limits: Json | null
          schema_definition: Json | null
          updated_at: string | null
        }
        Insert: {
          api_type: string
          authentication: Json
          base_url: string
          created_at?: string | null
          description?: string | null
          headers?: Json | null
          id?: string
          is_active?: boolean | null
          name: string
          organization_id: string
          rate_limits?: Json | null
          schema_definition?: Json | null
          updated_at?: string | null
        }
        Update: {
          api_type?: string
          authentication?: Json
          base_url?: string
          created_at?: string | null
          description?: string | null
          headers?: Json | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string
          rate_limits?: Json | null
          schema_definition?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_api_connectors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_integrations: {
        Row: {
          actions: Json
          approval_status: string | null
          auth_config: Json
          auth_type: string
          configuration_schema: Json
          created_at: string | null
          description: string | null
          developer_id: string
          documentation_url: string | null
          downloads_count: number | null
          id: string
          is_featured: boolean | null
          is_public: boolean | null
          is_verified: boolean | null
          logo_url: string | null
          name: string
          organization_id: string | null
          rating_average: number | null
          rating_count: number | null
          repository_url: string | null
          slug: string
          triggers: Json
          updated_at: string | null
          version: string
        }
        Insert: {
          actions: Json
          approval_status?: string | null
          auth_config: Json
          auth_type: string
          configuration_schema: Json
          created_at?: string | null
          description?: string | null
          developer_id: string
          documentation_url?: string | null
          downloads_count?: number | null
          id?: string
          is_featured?: boolean | null
          is_public?: boolean | null
          is_verified?: boolean | null
          logo_url?: string | null
          name: string
          organization_id?: string | null
          rating_average?: number | null
          rating_count?: number | null
          repository_url?: string | null
          slug: string
          triggers: Json
          updated_at?: string | null
          version?: string
        }
        Update: {
          actions?: Json
          approval_status?: string | null
          auth_config?: Json
          auth_type?: string
          configuration_schema?: Json
          created_at?: string | null
          description?: string | null
          developer_id?: string
          documentation_url?: string | null
          downloads_count?: number | null
          id?: string
          is_featured?: boolean | null
          is_public?: boolean | null
          is_verified?: boolean | null
          logo_url?: string | null
          name?: string
          organization_id?: string | null
          rating_average?: number | null
          rating_count?: number | null
          repository_url?: string | null
          slug?: string
          triggers?: Json
          updated_at?: string | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_integrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      data_deletion_requests: {
        Row: {
          completed_at: string | null
          created_at: string | null
          deletion_type: string
          id: string
          immediate: boolean
          integration_provider: string | null
          notes: string | null
          processed_by: string | null
          reason: string
          requested_at: string | null
          scheduled_for: string | null
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          deletion_type: string
          id?: string
          immediate?: boolean
          integration_provider?: string | null
          notes?: string | null
          processed_by?: string | null
          reason?: string
          requested_at?: string | null
          scheduled_for?: string | null
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          deletion_type?: string
          id?: string
          immediate?: boolean
          integration_provider?: string | null
          notes?: string | null
          processed_by?: string | null
          reason?: string
          requested_at?: string | null
          scheduled_for?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      data_subject_requests: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          created_at: string | null
          data_subject_email: string
          data_subject_id: string | null
          id: string
          organization_id: string
          request_details: Json | null
          request_type: string
          response_data: Json | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string | null
          data_subject_email: string
          data_subject_id?: string | null
          id?: string
          organization_id: string
          request_details?: Json | null
          request_type: string
          response_data?: Json | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string | null
          data_subject_email?: string
          data_subject_id?: string | null
          id?: string
          organization_id?: string
          request_details?: Json | null
          request_type?: string
          response_data?: Json | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "data_subject_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      database_connections: {
        Row: {
          connection_pool_config: Json | null
          connection_string: string
          created_at: string | null
          database_type: string
          encrypted_credentials: string
          id: string
          is_active: boolean | null
          last_tested_at: string | null
          name: string
          organization_id: string
          ssl_config: Json | null
          test_status: string | null
          updated_at: string | null
        }
        Insert: {
          connection_pool_config?: Json | null
          connection_string: string
          created_at?: string | null
          database_type: string
          encrypted_credentials: string
          id?: string
          is_active?: boolean | null
          last_tested_at?: string | null
          name: string
          organization_id: string
          ssl_config?: Json | null
          test_status?: string | null
          updated_at?: string | null
        }
        Update: {
          connection_pool_config?: Json | null
          connection_string?: string
          created_at?: string | null
          database_type?: string
          encrypted_credentials?: string
          id?: string
          is_active?: boolean | null
          last_tested_at?: string | null
          name?: string
          organization_id?: string
          ssl_config?: Json | null
          test_status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "database_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dead_letter_queue: {
        Row: {
          created_at: string | null
          error_data: Json
          execution_id: string
          id: string
          max_retries: number | null
          retry_count: number | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          error_data: Json
          execution_id: string
          id?: string
          max_retries?: number | null
          retry_count?: number | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          error_data?: Json
          execution_id?: string
          id?: string
          max_retries?: number | null
          retry_count?: number | null
          user_id?: string
        }
        Relationships: []
      }
      deployment_configurations: {
        Row: {
          backup_config: Json | null
          configuration: Json
          created_at: string | null
          custom_domain: string | null
          deployment_type: string
          disaster_recovery_config: Json | null
          id: string
          is_active: boolean | null
          organization_id: string
          ssl_certificate: string | null
          updated_at: string | null
          white_label_config: Json | null
        }
        Insert: {
          backup_config?: Json | null
          configuration: Json
          created_at?: string | null
          custom_domain?: string | null
          deployment_type: string
          disaster_recovery_config?: Json | null
          id?: string
          is_active?: boolean | null
          organization_id: string
          ssl_certificate?: string | null
          updated_at?: string | null
          white_label_config?: Json | null
        }
        Update: {
          backup_config?: Json | null
          configuration?: Json
          created_at?: string | null
          custom_domain?: string | null
          deployment_type?: string
          disaster_recovery_config?: Json | null
          id?: string
          is_active?: boolean | null
          organization_id?: string
          ssl_certificate?: string | null
          updated_at?: string | null
          white_label_config?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "deployment_configurations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      discord_invite_roles: {
        Row: {
          created_at: string | null
          created_by: string
          id: string
          integration_id: string
          invite_code: string
          organization_id: string
          role_id: string
          server_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by: string
          id?: string
          integration_id: string
          invite_code: string
          organization_id: string
          role_id: string
          server_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string
          id?: string
          integration_id?: string
          invite_code?: string
          organization_id?: string
          role_id?: string
          server_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "discord_invite_roles_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discord_invite_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dynamic_templates: {
        Row: {
          confidence_score: number | null
          created_at: string
          example_prompts: string[] | null
          generated_from_prompts: string[] | null
          id: string
          is_active: boolean
          is_validated: boolean
          metadata: Json | null
          min_similarity: number | null
          patterns: Json
          plan: Json
          provider_category: string | null
          requires_provider: boolean
          source_llm_responses: number | null
          supported_providers: string[] | null
          template_id: string
          template_name: string
          updated_at: string
          validated_at: string | null
          validated_by: string | null
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string
          example_prompts?: string[] | null
          generated_from_prompts?: string[] | null
          id?: string
          is_active?: boolean
          is_validated?: boolean
          metadata?: Json | null
          min_similarity?: number | null
          patterns: Json
          plan: Json
          provider_category?: string | null
          requires_provider?: boolean
          source_llm_responses?: number | null
          supported_providers?: string[] | null
          template_id: string
          template_name: string
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Update: {
          confidence_score?: number | null
          created_at?: string
          example_prompts?: string[] | null
          generated_from_prompts?: string[] | null
          id?: string
          is_active?: boolean
          is_validated?: boolean
          metadata?: Json | null
          min_similarity?: number | null
          patterns?: Json
          plan?: Json
          provider_category?: string | null
          requires_provider?: boolean
          source_llm_responses?: number | null
          supported_providers?: string[] | null
          template_id?: string
          template_name?: string
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Relationships: []
      }
      email_logs: {
        Row: {
          email_type: string
          id: string
          recipient: string
          sent_at: string | null
          status: string | null
          subject: string | null
          user_id: string | null
        }
        Insert: {
          email_type: string
          id?: string
          recipient: string
          sent_at?: string | null
          status?: string | null
          subject?: string | null
          user_id?: string | null
        }
        Update: {
          email_type?: string
          id?: string
          recipient?: string
          sent_at?: string | null
          status?: string | null
          subject?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      enterprise_integrations: {
        Row: {
          configuration: Json
          connection_status: string | null
          created_at: string | null
          credentials: Json
          error_count: number | null
          id: string
          integration_type: string
          last_error: string | null
          last_sync_at: string | null
          organization_id: string
          provider: string
          sync_frequency: string | null
          updated_at: string | null
        }
        Insert: {
          configuration: Json
          connection_status?: string | null
          created_at?: string | null
          credentials: Json
          error_count?: number | null
          id?: string
          integration_type: string
          last_error?: string | null
          last_sync_at?: string | null
          organization_id: string
          provider: string
          sync_frequency?: string | null
          updated_at?: string | null
        }
        Update: {
          configuration?: Json
          connection_status?: string | null
          created_at?: string | null
          credentials?: Json
          error_count?: number | null
          id?: string
          integration_type?: string
          last_error?: string | null
          last_sync_at?: string | null
          organization_id?: string
          provider?: string
          sync_frequency?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enterprise_integrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      error_reports: {
        Row: {
          config: Json | null
          created_at: string | null
          error_code: string
          error_details: Json | null
          error_message: string
          id: string
          node_type: string
          provider_id: string
          updated_at: string | null
          user_agent: string | null
          user_description: string | null
          user_email: string | null
        }
        Insert: {
          config?: Json | null
          created_at?: string | null
          error_code: string
          error_details?: Json | null
          error_message: string
          id?: string
          node_type: string
          provider_id: string
          updated_at?: string | null
          user_agent?: string | null
          user_description?: string | null
          user_email?: string | null
        }
        Update: {
          config?: Json | null
          created_at?: string | null
          error_code?: string
          error_details?: Json | null
          error_message?: string
          id?: string
          node_type?: string
          provider_id?: string
          updated_at?: string | null
          user_agent?: string | null
          user_description?: string | null
          user_email?: string | null
        }
        Relationships: []
      }
      execution_branches: {
        Row: {
          branch_name: string
          completed_at: string | null
          created_at: string | null
          end_node_id: string | null
          execution_data: Json | null
          id: string
          session_id: string
          start_node_id: string
          started_at: string | null
          status: string | null
        }
        Insert: {
          branch_name: string
          completed_at?: string | null
          created_at?: string | null
          end_node_id?: string | null
          execution_data?: Json | null
          id?: string
          session_id: string
          start_node_id: string
          started_at?: string | null
          status?: string | null
        }
        Update: {
          branch_name?: string
          completed_at?: string | null
          created_at?: string | null
          end_node_id?: string | null
          execution_data?: Json | null
          id?: string
          session_id?: string
          start_node_id?: string
          started_at?: string | null
          status?: string | null
        }
        Relationships: []
      }
      execution_progress: {
        Row: {
          completed_at: string | null
          completed_nodes: string[] | null
          current_node_id: string | null
          current_node_name: string | null
          current_step: number | null
          error_message: string | null
          execution_id: string
          failed_nodes: Json | null
          id: string
          node_outputs: Json | null
          pending_nodes: string[] | null
          percentage: number | null
          progress_percentage: number | null
          started_at: string | null
          status: string | null
          total_steps: number | null
          updated_at: string | null
          user_id: string | null
          workflow_id: string | null
        }
        Insert: {
          completed_at?: string | null
          completed_nodes?: string[] | null
          current_node_id?: string | null
          current_node_name?: string | null
          current_step?: number | null
          error_message?: string | null
          execution_id: string
          failed_nodes?: Json | null
          id?: string
          node_outputs?: Json | null
          pending_nodes?: string[] | null
          percentage?: number | null
          progress_percentage?: number | null
          started_at?: string | null
          status?: string | null
          total_steps?: number | null
          updated_at?: string | null
          user_id?: string | null
          workflow_id?: string | null
        }
        Update: {
          completed_at?: string | null
          completed_nodes?: string[] | null
          current_node_id?: string | null
          current_node_name?: string | null
          current_step?: number | null
          error_message?: string | null
          execution_id?: string
          failed_nodes?: Json | null
          id?: string
          node_outputs?: Json | null
          pending_nodes?: string[] | null
          percentage?: number | null
          progress_percentage?: number | null
          started_at?: string | null
          status?: string | null
          total_steps?: number | null
          updated_at?: string | null
          user_id?: string | null
          workflow_id?: string | null
        }
        Relationships: []
      }
      execution_retries: {
        Row: {
          attempt_number: number
          created_at: string | null
          error_message: string | null
          execution_id: string
          id: string
          retry_at: string
          status: string | null
        }
        Insert: {
          attempt_number: number
          created_at?: string | null
          error_message?: string | null
          execution_id: string
          id?: string
          retry_at: string
          status?: string | null
        }
        Update: {
          attempt_number?: number
          created_at?: string | null
          error_message?: string | null
          execution_id?: string
          id?: string
          retry_at?: string
          status?: string | null
        }
        Relationships: []
      }
      execution_steps: {
        Row: {
          completed_at: string | null
          created_at: string
          duration_ms: number | null
          error_details: Json | null
          error_message: string | null
          execution_id: string
          id: string
          input_data: Json | null
          node_id: string
          node_name: string | null
          node_type: string
          output_data: Json | null
          started_at: string | null
          status: string
          step_number: number
          test_mode_preview: Json | null
          updated_at: string
          warnings: Json | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          error_details?: Json | null
          error_message?: string | null
          execution_id: string
          id?: string
          input_data?: Json | null
          node_id: string
          node_name?: string | null
          node_type: string
          output_data?: Json | null
          started_at?: string | null
          status: string
          step_number: number
          test_mode_preview?: Json | null
          updated_at?: string
          warnings?: Json | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          error_details?: Json | null
          error_message?: string | null
          execution_id?: string
          id?: string
          input_data?: Json | null
          node_id?: string
          node_name?: string | null
          node_type?: string
          output_data?: Json | null
          started_at?: string | null
          status?: string
          step_number?: number
          test_mode_preview?: Json | null
          updated_at?: string
          warnings?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "execution_steps_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "workflow_execution_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      executions: {
        Row: {
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          execution_time_ms: number | null
          id: string
          input_data: Json | null
          output_data: Json | null
          paused_at: string | null
          paused_node_id: string | null
          resume_data: Json | null
          started_at: string | null
          status: string | null
          test_mode: boolean | null
          user_id: string | null
          workflow_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          execution_time_ms?: number | null
          id?: string
          input_data?: Json | null
          output_data?: Json | null
          paused_at?: string | null
          paused_node_id?: string | null
          resume_data?: Json | null
          started_at?: string | null
          status?: string | null
          test_mode?: boolean | null
          user_id?: string | null
          workflow_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          execution_time_ms?: number | null
          id?: string
          input_data?: Json | null
          output_data?: Json | null
          paused_at?: string | null
          paused_node_id?: string | null
          resume_data?: Json | null
          started_at?: string | null
          status?: string | null
          test_mode?: boolean | null
          user_id?: string | null
          workflow_id?: string
        }
        Relationships: []
      }
      gdpr_data_processing: {
        Row: {
          consent_date: string | null
          consent_given: boolean | null
          consent_withdrawn: boolean | null
          consent_withdrawn_date: string | null
          created_at: string | null
          data_categories: string[] | null
          data_subject_id: string | null
          id: string
          legal_basis: string
          organization_id: string
          processing_purpose: string
          retention_period: string | null
          updated_at: string | null
        }
        Insert: {
          consent_date?: string | null
          consent_given?: boolean | null
          consent_withdrawn?: boolean | null
          consent_withdrawn_date?: string | null
          created_at?: string | null
          data_categories?: string[] | null
          data_subject_id?: string | null
          id?: string
          legal_basis: string
          organization_id: string
          processing_purpose: string
          retention_period?: string | null
          updated_at?: string | null
        }
        Update: {
          consent_date?: string | null
          consent_given?: boolean | null
          consent_withdrawn?: boolean | null
          consent_withdrawn_date?: string | null
          created_at?: string | null
          data_categories?: string[] | null
          data_subject_id?: string | null
          id?: string
          legal_basis?: string
          organization_id?: string
          processing_purpose?: string
          retention_period?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gdpr_data_processing_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      google_watch_renewal_failures: {
        Row: {
          error: string | null
          failed_at: string | null
          id: string
          integration_id: string | null
        }
        Insert: {
          error?: string | null
          failed_at?: string | null
          id?: string
          integration_id?: string | null
        }
        Update: {
          error?: string | null
          failed_at?: string | null
          id?: string
          integration_id?: string | null
        }
        Relationships: []
      }
      google_watch_subscriptions: {
        Row: {
          channel_id: string | null
          created_at: string | null
          email_address: string | null
          expiration: string
          history_id: string | null
          id: string
          integration_id: string | null
          metadata: Json | null
          page_token: string | null
          provider: string | null
          resource_id: string | null
          status: string | null
          sync_token: string | null
          updated_at: string | null
          user_id: string
          workflow_id: string | null
        }
        Insert: {
          channel_id?: string | null
          created_at?: string | null
          email_address?: string | null
          expiration: string
          history_id?: string | null
          id?: string
          integration_id?: string | null
          metadata?: Json | null
          page_token?: string | null
          provider?: string | null
          resource_id?: string | null
          status?: string | null
          sync_token?: string | null
          updated_at?: string | null
          user_id: string
          workflow_id?: string | null
        }
        Update: {
          channel_id?: string | null
          created_at?: string | null
          email_address?: string | null
          expiration?: string
          history_id?: string | null
          id?: string
          integration_id?: string | null
          metadata?: Json | null
          page_token?: string | null
          provider?: string | null
          resource_id?: string | null
          status?: string | null
          sync_token?: string | null
          updated_at?: string | null
          user_id?: string
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "google_watch_subscriptions_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "google_watch_subscriptions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      hitl_conversations: {
        Row: {
          channel_id: string | null
          channel_type: string | null
          completed_at: string | null
          context_data: string | null
          continuation_signals: Json | null
          conversation_history: Json | null
          created_at: string | null
          execution_id: string | null
          external_user_id: string | null
          extract_variables: Json | null
          extracted_variables: Json | null
          guild_id: string | null
          id: string
          initial_message: string | null
          initial_message_id: string | null
          knowledge_base_used: Json | null
          learnings_extracted: Json | null
          memory_context_provided: string | null
          messages: Json | null
          metadata: Json | null
          node_id: string | null
          started_at: string | null
          status: string | null
          system_prompt: string | null
          thread_id: string | null
          timeout_action: string | null
          timeout_at: string | null
          timeout_minutes: number | null
          updated_at: string | null
          user_id: string | null
          workflow_id: string
        }
        Insert: {
          channel_id?: string | null
          channel_type?: string | null
          completed_at?: string | null
          context_data?: string | null
          continuation_signals?: Json | null
          conversation_history?: Json | null
          created_at?: string | null
          execution_id?: string | null
          external_user_id?: string | null
          extract_variables?: Json | null
          extracted_variables?: Json | null
          guild_id?: string | null
          id?: string
          initial_message?: string | null
          initial_message_id?: string | null
          knowledge_base_used?: Json | null
          learnings_extracted?: Json | null
          memory_context_provided?: string | null
          messages?: Json | null
          metadata?: Json | null
          node_id?: string | null
          started_at?: string | null
          status?: string | null
          system_prompt?: string | null
          thread_id?: string | null
          timeout_action?: string | null
          timeout_at?: string | null
          timeout_minutes?: number | null
          updated_at?: string | null
          user_id?: string | null
          workflow_id: string
        }
        Update: {
          channel_id?: string | null
          channel_type?: string | null
          completed_at?: string | null
          context_data?: string | null
          continuation_signals?: Json | null
          conversation_history?: Json | null
          created_at?: string | null
          execution_id?: string | null
          external_user_id?: string | null
          extract_variables?: Json | null
          extracted_variables?: Json | null
          guild_id?: string | null
          id?: string
          initial_message?: string | null
          initial_message_id?: string | null
          knowledge_base_used?: Json | null
          learnings_extracted?: Json | null
          memory_context_provided?: string | null
          messages?: Json | null
          metadata?: Json | null
          node_id?: string | null
          started_at?: string | null
          status?: string | null
          system_prompt?: string | null
          thread_id?: string | null
          timeout_action?: string | null
          timeout_at?: string | null
          timeout_minutes?: number | null
          updated_at?: string | null
          user_id?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hitl_conversations_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      hitl_memory: {
        Row: {
          category: string | null
          confidence_score: number | null
          conversation_id: string | null
          created_at: string | null
          id: string
          learning_data: Json | null
          learning_summary: string | null
          memory_key: string
          memory_value: string | null
          scope: string | null
          source_conversation_id: string | null
          updated_at: string | null
          usage_count: number | null
          user_id: string | null
          workflow_id: string | null
        }
        Insert: {
          category?: string | null
          confidence_score?: number | null
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          learning_data?: Json | null
          learning_summary?: string | null
          memory_key: string
          memory_value?: string | null
          scope?: string | null
          source_conversation_id?: string | null
          updated_at?: string | null
          usage_count?: number | null
          user_id?: string | null
          workflow_id?: string | null
        }
        Update: {
          category?: string | null
          confidence_score?: number | null
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          learning_data?: Json | null
          learning_summary?: string | null
          memory_key?: string
          memory_value?: string | null
          scope?: string | null
          source_conversation_id?: string | null
          updated_at?: string | null
          usage_count?: number | null
          user_id?: string | null
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hitl_memory_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "hitl_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hitl_memory_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_configs: {
        Row: {
          config_data: Json | null
          created_at: string | null
          id: string
          integration_id: string | null
        }
        Insert: {
          config_data?: Json | null
          created_at?: string | null
          id?: string
          integration_id?: string | null
        }
        Update: {
          config_data?: Json | null
          created_at?: string | null
          id?: string
          integration_id?: string | null
        }
        Relationships: []
      }
      integration_health_scores: {
        Row: {
          calculated_at: string | null
          error_rate: number | null
          health_score: number
          id: string
          integration_id: string
          last_error_at: string | null
          performance_score: number | null
          reliability_score: number | null
          response_time_avg: number | null
          uptime_percentage: number | null
          user_id: string
        }
        Insert: {
          calculated_at?: string | null
          error_rate?: number | null
          health_score: number
          id?: string
          integration_id: string
          last_error_at?: string | null
          performance_score?: number | null
          reliability_score?: number | null
          response_time_avg?: number | null
          uptime_percentage?: number | null
          user_id: string
        }
        Update: {
          calculated_at?: string | null
          error_rate?: number | null
          health_score?: number
          id?: string
          integration_id?: string
          last_error_at?: string | null
          performance_score?: number | null
          reliability_score?: number | null
          response_time_avg?: number | null
          uptime_percentage?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_health_scores_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_permissions: {
        Row: {
          granted_at: string | null
          granted_by: string | null
          id: string
          integration_id: string
          permission: string
          user_id: string
        }
        Insert: {
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          integration_id: string
          permission: string
          user_id: string
        }
        Update: {
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          integration_id?: string
          permission?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_permissions_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_shares: {
        Row: {
          created_at: string | null
          id: string
          integration_id: string
          permission_level: string
          shared_by: string
          shared_with_team_id: string | null
          shared_with_user_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          integration_id: string
          permission_level?: string
          shared_by: string
          shared_with_team_id?: string | null
          shared_with_user_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          integration_id?: string
          permission_level?: string
          shared_by?: string
          shared_with_team_id?: string | null
          shared_with_user_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_shares_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_shares_shared_with_team_id_fkey"
            columns: ["shared_with_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_tokens: {
        Row: {
          access_token: string | null
          created_at: string | null
          expires_at: string | null
          id: string
          integration_id: string | null
          refresh_token: string | null
        }
        Insert: {
          access_token?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          integration_id?: string | null
          refresh_token?: string | null
        }
        Update: {
          access_token?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          integration_id?: string | null
          refresh_token?: string | null
        }
        Relationships: []
      }
      integration_webhook_executions: {
        Row: {
          executed_at: string | null
          id: string
          integration_webhook_id: string | null
          payload: Json | null
          status: string | null
        }
        Insert: {
          executed_at?: string | null
          id?: string
          integration_webhook_id?: string | null
          payload?: Json | null
          status?: string | null
        }
        Update: {
          executed_at?: string | null
          id?: string
          integration_webhook_id?: string | null
          payload?: Json | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_webhook_executions_integration_webhook_id_fkey"
            columns: ["integration_webhook_id"]
            isOneToOne: false
            referencedRelation: "integration_webhooks"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_webhooks: {
        Row: {
          created_at: string | null
          id: string
          integration_id: string | null
          is_active: boolean | null
          metadata: Json | null
          webhook_secret: string | null
          webhook_url: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          integration_id?: string | null
          is_active?: boolean | null
          metadata?: Json | null
          webhook_secret?: string | null
          webhook_url: string
        }
        Update: {
          created_at?: string | null
          id?: string
          integration_id?: string | null
          is_active?: boolean | null
          metadata?: Json | null
          webhook_secret?: string | null
          webhook_url?: string
        }
        Relationships: []
      }
      integrations: {
        Row: {
          access_token: string | null
          account_name: string | null
          avatar_url: string | null
          connected_by: string | null
          consecutive_failures: number | null
          consecutive_transient_failures: number | null
          created_at: string | null
          disconnect_reason: string | null
          disconnected_at: string | null
          display_name: string | null
          email: string | null
          expires_at: string | null
          health_check_status: string | null
          id: string
          is_active: boolean | null
          last_error_code: string | null
          last_error_details: Json | null
          last_failure_at: string | null
          last_health_check_at: string | null
          last_notification_milestone: string | null
          last_notified_at: string | null
          last_refresh_attempt: string | null
          last_refresh_success: string | null
          last_token_refresh: string | null
          metadata: Json | null
          next_health_check_at: string | null
          provider: string
          provider_account_id: string | null
          provider_plan: string | null
          provider_user_id: string | null
          refresh_lock_at: string | null
          refresh_lock_id: string | null
          refresh_token: string | null
          refresh_token_expires_at: string | null
          requires_user_action: boolean | null
          scopes: string[] | null
          shared_at: string | null
          sharing_scope: string | null
          status: string | null
          team_id: string | null
          updated_at: string | null
          user_action_deadline: string | null
          user_action_notified_at: string | null
          user_action_type: string | null
          user_id: string | null
          username: string | null
          workspace_id: string | null
          workspace_type: string
        }
        Insert: {
          access_token?: string | null
          account_name?: string | null
          avatar_url?: string | null
          connected_by?: string | null
          consecutive_failures?: number | null
          consecutive_transient_failures?: number | null
          created_at?: string | null
          disconnect_reason?: string | null
          disconnected_at?: string | null
          display_name?: string | null
          email?: string | null
          expires_at?: string | null
          health_check_status?: string | null
          id?: string
          is_active?: boolean | null
          last_error_code?: string | null
          last_error_details?: Json | null
          last_failure_at?: string | null
          last_health_check_at?: string | null
          last_notification_milestone?: string | null
          last_notified_at?: string | null
          last_refresh_attempt?: string | null
          last_refresh_success?: string | null
          last_token_refresh?: string | null
          metadata?: Json | null
          next_health_check_at?: string | null
          provider: string
          provider_account_id?: string | null
          provider_plan?: string | null
          provider_user_id?: string | null
          refresh_lock_at?: string | null
          refresh_lock_id?: string | null
          refresh_token?: string | null
          refresh_token_expires_at?: string | null
          requires_user_action?: boolean | null
          scopes?: string[] | null
          shared_at?: string | null
          sharing_scope?: string | null
          status?: string | null
          team_id?: string | null
          updated_at?: string | null
          user_action_deadline?: string | null
          user_action_notified_at?: string | null
          user_action_type?: string | null
          user_id?: string | null
          username?: string | null
          workspace_id?: string | null
          workspace_type?: string
        }
        Update: {
          access_token?: string | null
          account_name?: string | null
          avatar_url?: string | null
          connected_by?: string | null
          consecutive_failures?: number | null
          consecutive_transient_failures?: number | null
          created_at?: string | null
          disconnect_reason?: string | null
          disconnected_at?: string | null
          display_name?: string | null
          email?: string | null
          expires_at?: string | null
          health_check_status?: string | null
          id?: string
          is_active?: boolean | null
          last_error_code?: string | null
          last_error_details?: Json | null
          last_failure_at?: string | null
          last_health_check_at?: string | null
          last_notification_milestone?: string | null
          last_notified_at?: string | null
          last_refresh_attempt?: string | null
          last_refresh_success?: string | null
          last_token_refresh?: string | null
          metadata?: Json | null
          next_health_check_at?: string | null
          provider?: string
          provider_account_id?: string | null
          provider_plan?: string | null
          provider_user_id?: string | null
          refresh_lock_at?: string | null
          refresh_lock_id?: string | null
          refresh_token?: string | null
          refresh_token_expires_at?: string | null
          requires_user_action?: boolean | null
          scopes?: string[] | null
          shared_at?: string | null
          sharing_scope?: string | null
          status?: string | null
          team_id?: string | null
          updated_at?: string | null
          user_action_deadline?: string | null
          user_action_notified_at?: string | null
          user_action_type?: string | null
          user_id?: string | null
          username?: string | null
          workspace_id?: string | null
          workspace_type?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          amount: number
          billing_reason: string | null
          created_at: string | null
          hosted_invoice_url: string | null
          id: string
          invoice_pdf: string | null
          organization_id: string | null
          status: string
          stripe_invoice_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          amount: number
          billing_reason?: string | null
          created_at?: string | null
          hosted_invoice_url?: string | null
          id?: string
          invoice_pdf?: string | null
          organization_id?: string | null
          status: string
          stripe_invoice_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          billing_reason?: string | null
          created_at?: string | null
          hosted_invoice_url?: string | null
          id?: string
          invoice_pdf?: string | null
          organization_id?: string | null
          status?: string
          stripe_invoice_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      live_execution_events: {
        Row: {
          created_at: string | null
          event_data: Json | null
          event_type: string
          execution_id: string
          id: string
        }
        Insert: {
          created_at?: string | null
          event_data?: Json | null
          event_type: string
          execution_id: string
          id?: string
        }
        Update: {
          created_at?: string | null
          event_data?: Json | null
          event_type?: string
          execution_id?: string
          id?: string
        }
        Relationships: []
      }
      loop_executions: {
        Row: {
          created_at: string | null
          current_item_index: number | null
          id: string
          iteration_count: number | null
          loop_data: Json | null
          max_iterations: number | null
          node_id: string
          session_id: string
          status: string | null
        }
        Insert: {
          created_at?: string | null
          current_item_index?: number | null
          id?: string
          iteration_count?: number | null
          loop_data?: Json | null
          max_iterations?: number | null
          node_id: string
          session_id: string
          status?: string | null
        }
        Update: {
          created_at?: string | null
          current_item_index?: number | null
          id?: string
          iteration_count?: number | null
          loop_data?: Json | null
          max_iterations?: number | null
          node_id?: string
          session_id?: string
          status?: string | null
        }
        Relationships: []
      }
      microsoft_graph_delta_tokens: {
        Row: {
          delta_token: string
          id: string
          integration_id: string | null
          resource_type: string
          updated_at: string | null
        }
        Insert: {
          delta_token: string
          id?: string
          integration_id?: string | null
          resource_type: string
          updated_at?: string | null
        }
        Update: {
          delta_token?: string
          id?: string
          integration_id?: string | null
          resource_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      microsoft_graph_events: {
        Row: {
          created_at: string | null
          event_data: Json | null
          event_type: string
          id: string
          integration_id: string | null
          processed: boolean | null
        }
        Insert: {
          created_at?: string | null
          event_data?: Json | null
          event_type: string
          id?: string
          integration_id?: string | null
          processed?: boolean | null
        }
        Update: {
          created_at?: string | null
          event_data?: Json | null
          event_type?: string
          id?: string
          integration_id?: string | null
          processed?: boolean | null
        }
        Relationships: []
      }
      microsoft_graph_subscriptions: {
        Row: {
          change_type: string
          client_state: string | null
          created_at: string | null
          expiration_datetime: string
          id: string
          metadata: Json | null
          notification_url: string | null
          resource: string
          status: string | null
          subscription_id: string
          updated_at: string | null
          user_id: string
          workflow_id: string | null
        }
        Insert: {
          change_type: string
          client_state?: string | null
          created_at?: string | null
          expiration_datetime: string
          id?: string
          metadata?: Json | null
          notification_url?: string | null
          resource: string
          status?: string | null
          subscription_id: string
          updated_at?: string | null
          user_id: string
          workflow_id?: string | null
        }
        Update: {
          change_type?: string
          client_state?: string | null
          created_at?: string | null
          expiration_datetime?: string
          id?: string
          metadata?: Json | null
          notification_url?: string | null
          resource?: string
          status?: string | null
          subscription_id?: string
          updated_at?: string | null
          user_id?: string
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "microsoft_graph_subscriptions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      microsoft_webhook_dedup: {
        Row: {
          created_at: string
          dedup_key: string | null
          id: string
          processed_at: string | null
          resource_data_hash: string
          subscription_id: string
        }
        Insert: {
          created_at?: string
          dedup_key?: string | null
          id?: string
          processed_at?: string | null
          resource_data_hash: string
          subscription_id: string
        }
        Update: {
          created_at?: string
          dedup_key?: string | null
          id?: string
          processed_at?: string | null
          resource_data_hash?: string
          subscription_id?: string
        }
        Relationships: []
      }
      microsoft_webhook_queue: {
        Row: {
          change_type: string
          client_state: string | null
          created_at: string | null
          error: string | null
          id: string
          integration_id: string | null
          processed: boolean | null
          processed_at: string | null
          resource_data: Json | null
          resource_type: string
          retry_count: number | null
          subscription_id: string | null
          user_id: string | null
        }
        Insert: {
          change_type: string
          client_state?: string | null
          created_at?: string | null
          error?: string | null
          id?: string
          integration_id?: string | null
          processed?: boolean | null
          processed_at?: string | null
          resource_data?: Json | null
          resource_type: string
          retry_count?: number | null
          subscription_id?: string | null
          user_id?: string | null
        }
        Update: {
          change_type?: string
          client_state?: string | null
          created_at?: string | null
          error?: string | null
          id?: string
          integration_id?: string | null
          processed?: boolean | null
          processed_at?: string | null
          resource_data?: Json | null
          resource_type?: string
          retry_count?: number | null
          subscription_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      monthly_ai_costs: {
        Row: {
          ai_agent_cost: number | null
          ai_assistant_cost: number | null
          ai_compose_cost: number | null
          created_at: string | null
          id: string
          month: number
          total_cost: number | null
          total_tokens: number | null
          updated_at: string | null
          user_id: string | null
          year: number
        }
        Insert: {
          ai_agent_cost?: number | null
          ai_assistant_cost?: number | null
          ai_compose_cost?: number | null
          created_at?: string | null
          id?: string
          month: number
          total_cost?: number | null
          total_tokens?: number | null
          updated_at?: string | null
          user_id?: string | null
          year: number
        }
        Update: {
          ai_agent_cost?: number | null
          ai_assistant_cost?: number | null
          ai_compose_cost?: number | null
          created_at?: string | null
          id?: string
          month?: number
          total_cost?: number | null
          total_tokens?: number | null
          updated_at?: string | null
          user_id?: string | null
          year?: number
        }
        Relationships: []
      }
      monthly_usage: {
        Row: {
          ai_agent_executions: number | null
          ai_assistant_calls: number | null
          ai_compose_uses: number | null
          created_at: string | null
          execution_count: number | null
          id: string
          integration_count: number | null
          month: number
          organization_id: string | null
          storage_used_mb: number | null
          team_member_count: number | null
          updated_at: string | null
          user_id: string
          workflow_count: number | null
          year: number
        }
        Insert: {
          ai_agent_executions?: number | null
          ai_assistant_calls?: number | null
          ai_compose_uses?: number | null
          created_at?: string | null
          execution_count?: number | null
          id?: string
          integration_count?: number | null
          month: number
          organization_id?: string | null
          storage_used_mb?: number | null
          team_member_count?: number | null
          updated_at?: string | null
          user_id: string
          workflow_count?: number | null
          year: number
        }
        Update: {
          ai_agent_executions?: number | null
          ai_assistant_calls?: number | null
          ai_compose_uses?: number | null
          created_at?: string | null
          execution_count?: number | null
          id?: string
          integration_count?: number | null
          month?: number
          organization_id?: string | null
          storage_used_mb?: number | null
          team_member_count?: number | null
          updated_at?: string | null
          user_id?: string
          workflow_count?: number | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "monthly_usage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_label: string | null
          action_url: string | null
          created_at: string | null
          expires_at: string | null
          id: string
          is_read: boolean | null
          message: string
          metadata: Json | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          action_label?: string | null
          action_url?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          metadata?: Json | null
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          action_label?: string | null
          action_url?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          metadata?: Json | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      organization_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string | null
          email: string
          expires_at: string
          id: string
          invited_by: string
          organization_id: string
          permissions: Json | null
          role: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string | null
          email: string
          expires_at: string
          id?: string
          invited_by: string
          organization_id: string
          permissions?: Json | null
          role?: string
          token: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string | null
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          organization_id?: string
          permissions?: Json | null
          role?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          billing_address: Json | null
          billing_email: string | null
          created_at: string | null
          description: string | null
          id: string
          logo_url: string | null
          name: string
          owner_id: string
          settings: Json | null
          slug: string | null
          updated_at: string | null
        }
        Insert: {
          billing_address?: Json | null
          billing_email?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          logo_url?: string | null
          name: string
          owner_id: string
          settings?: Json | null
          slug?: string | null
          updated_at?: string | null
        }
        Update: {
          billing_address?: Json | null
          billing_email?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          owner_id?: string
          settings?: Json | null
          slug?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      pack_purchases: {
        Row: {
          created_at: string
          id: string
          pack_price_cents: number
          pack_size: number
          paid_at: string | null
          plan_code: string
          refunded_at: string | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          tasks_consumed: number
          tasks_remaining: number
          triggered_by: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          pack_price_cents: number
          pack_size: number
          paid_at?: string | null
          plan_code: string
          refunded_at?: string | null
          status: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          tasks_consumed?: number
          tasks_remaining: number
          triggered_by: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          pack_price_cents?: number
          pack_size?: number
          paid_at?: string | null
          plan_code?: string
          refunded_at?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          tasks_consumed?: number
          tasks_remaining?: number
          triggered_by?: string
          user_id?: string
        }
        Relationships: []
      }
      pkce_flow: {
        Row: {
          code_verifier: string
          created_at: string
          provider: string
          state: string
        }
        Insert: {
          code_verifier: string
          created_at?: string
          provider: string
          state: string
        }
        Update: {
          code_verifier?: string
          created_at?: string
          provider?: string
          state?: string
        }
        Relationships: []
      }
      plan_audit_log: {
        Row: {
          changed_at: string
          changed_by: string | null
          field_name: string
          id: string
          new_value: Json | null
          old_value: Json | null
          plan_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          field_name: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          plan_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          field_name?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_audit_log_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          code: string
          created_at: string | null
          description: string | null
          display_name: string | null
          feature_flags: Json | null
          features: Json | null
          history_retention_days: number | null
          id: string
          is_active: boolean | null
          limits: Json | null
          max_ai_agent_executions: number | null
          max_ai_assistant_calls: number | null
          max_ai_compose_uses: number | null
          max_business_context_entries: number | null
          max_executions_per_month: number | null
          max_integrations: number | null
          max_nodes_per_workflow: number | null
          max_storage_mb: number | null
          max_team_members: number | null
          max_workflows: number | null
          name: string
          pack_price_cents: number | null
          pack_size: number | null
          price_monthly: number | null
          price_yearly: number | null
          sort_order: number | null
          stripe_metered_price_id_monthly: string | null
          stripe_metered_price_id_yearly: string | null
          stripe_pack_price_id: string | null
          stripe_price_id_monthly: string | null
          stripe_price_id_yearly: string | null
          tasks_per_month: number | null
          updated_at: string | null
          updated_by: string | null
          version: number | null
        }
        Insert: {
          code: string
          created_at?: string | null
          description?: string | null
          display_name?: string | null
          feature_flags?: Json | null
          features?: Json | null
          history_retention_days?: number | null
          id?: string
          is_active?: boolean | null
          limits?: Json | null
          max_ai_agent_executions?: number | null
          max_ai_assistant_calls?: number | null
          max_ai_compose_uses?: number | null
          max_business_context_entries?: number | null
          max_executions_per_month?: number | null
          max_integrations?: number | null
          max_nodes_per_workflow?: number | null
          max_storage_mb?: number | null
          max_team_members?: number | null
          max_workflows?: number | null
          name: string
          pack_price_cents?: number | null
          pack_size?: number | null
          price_monthly?: number | null
          price_yearly?: number | null
          sort_order?: number | null
          stripe_metered_price_id_monthly?: string | null
          stripe_metered_price_id_yearly?: string | null
          stripe_pack_price_id?: string | null
          stripe_price_id_monthly?: string | null
          stripe_price_id_yearly?: string | null
          tasks_per_month?: number | null
          updated_at?: string | null
          updated_by?: string | null
          version?: number | null
        }
        Update: {
          code?: string
          created_at?: string | null
          description?: string | null
          display_name?: string | null
          feature_flags?: Json | null
          features?: Json | null
          history_retention_days?: number | null
          id?: string
          is_active?: boolean | null
          limits?: Json | null
          max_ai_agent_executions?: number | null
          max_ai_assistant_calls?: number | null
          max_ai_compose_uses?: number | null
          max_business_context_entries?: number | null
          max_executions_per_month?: number | null
          max_integrations?: number | null
          max_nodes_per_workflow?: number | null
          max_storage_mb?: number | null
          max_team_members?: number | null
          max_workflows?: number | null
          name?: string
          pack_price_cents?: number | null
          pack_size?: number | null
          price_monthly?: number | null
          price_yearly?: number | null
          sort_order?: number | null
          stripe_metered_price_id_monthly?: string | null
          stripe_metered_price_id_yearly?: string | null
          stripe_pack_price_id?: string | null
          stripe_price_id_monthly?: string | null
          stripe_price_id_yearly?: string | null
          tasks_per_month?: number | null
          updated_at?: string | null
          updated_by?: string | null
          version?: number | null
        }
        Relationships: []
      }
      predictions: {
        Row: {
          actual_outcome: Json | null
          confidence_score: number | null
          created_at: string | null
          id: string
          input_data: Json
          model_id: string
          organization_id: string | null
          outcome_recorded_at: string | null
          prediction_result: Json
          prediction_type: string
          user_id: string
        }
        Insert: {
          actual_outcome?: Json | null
          confidence_score?: number | null
          created_at?: string | null
          id?: string
          input_data: Json
          model_id: string
          organization_id?: string | null
          outcome_recorded_at?: string | null
          prediction_result: Json
          prediction_type: string
          user_id: string
        }
        Update: {
          actual_outcome?: Json | null
          confidence_score?: number | null
          created_at?: string | null
          id?: string
          input_data?: Json
          model_id?: string
          organization_id?: string | null
          outcome_recorded_at?: string | null
          prediction_result?: Json
          prediction_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "predictions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      presence_stats: {
        Row: {
          created_at: string | null
          date: string
          id: string
          peak_online: number | null
          total_online: number | null
        }
        Insert: {
          created_at?: string | null
          date: string
          id?: string
          peak_online?: number | null
          total_online?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string
          id?: string
          peak_online?: number | null
          total_online?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string
          provider: string | null
          tasks_limit: number | null
          tasks_used: number | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          provider?: string | null
          tasks_limit?: number | null
          tasks_used?: number | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          provider?: string | null
          tasks_limit?: number | null
          tasks_used?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      prompt_clusters: {
        Row: {
          avg_node_count: number | null
          cluster_key: string
          cluster_name: string
          common_keywords: string[] | null
          common_providers: string[] | null
          created_at: string
          generated_at: string | null
          id: string
          prompt_count: number
          prompt_ids: string[]
          template_candidate: boolean | null
          template_id: string | null
          updated_at: string
        }
        Insert: {
          avg_node_count?: number | null
          cluster_key: string
          cluster_name: string
          common_keywords?: string[] | null
          common_providers?: string[] | null
          created_at?: string
          generated_at?: string | null
          id?: string
          prompt_count?: number
          prompt_ids: string[]
          template_candidate?: boolean | null
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          avg_node_count?: number | null
          cluster_key?: string
          cluster_name?: string
          common_keywords?: string[] | null
          common_providers?: string[] | null
          created_at?: string
          generated_at?: string | null
          id?: string
          prompt_count?: number
          prompt_ids?: string[]
          template_candidate?: boolean | null
          template_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      roi_calculations: {
        Row: {
          calculated_at: string | null
          calculation_period_end: string | null
          calculation_period_start: string | null
          cost_saved_amount: number | null
          id: string
          implementation_cost: number | null
          organization_id: string | null
          revenue_generated: number | null
          roi_percentage: number | null
          time_saved_hours: number | null
          user_id: string
          workflow_id: string
        }
        Insert: {
          calculated_at?: string | null
          calculation_period_end?: string | null
          calculation_period_start?: string | null
          cost_saved_amount?: number | null
          id?: string
          implementation_cost?: number | null
          organization_id?: string | null
          revenue_generated?: number | null
          roi_percentage?: number | null
          time_saved_hours?: number | null
          user_id: string
          workflow_id: string
        }
        Update: {
          calculated_at?: string | null
          calculation_period_end?: string | null
          calculation_period_start?: string | null
          cost_saved_amount?: number | null
          id?: string
          implementation_cost?: number | null
          organization_id?: string | null
          revenue_generated?: number | null
          roi_percentage?: number | null
          time_saved_hours?: number | null
          user_id?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roi_calculations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      session_side_effects: {
        Row: {
          action_type: string
          execution_session_id: string
          external_id: string | null
          fired_at: string
          id: string
          node_id: string
          payload_hash: string
          provider: string
          result_snapshot: Json
          root_execution_id: string | null
        }
        Insert: {
          action_type: string
          execution_session_id: string
          external_id?: string | null
          fired_at?: string
          id?: string
          node_id: string
          payload_hash: string
          provider: string
          result_snapshot: Json
          root_execution_id?: string | null
        }
        Update: {
          action_type?: string
          execution_session_id?: string
          external_id?: string | null
          fired_at?: string
          id?: string
          node_id?: string
          payload_hash?: string
          provider?: string
          result_snapshot?: Json
          root_execution_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "session_side_effects_session_fk"
            columns: ["execution_session_id"]
            isOneToOne: false
            referencedRelation: "workflow_execution_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      social_post_submissions: {
        Row: {
          created_at: string
          id: string
          last_verification_attempt: string | null
          platform: string
          post_url: string
          status: string
          tasks_granted: number
          updated_at: string
          user_id: string
          verification_attempts: number | null
          verification_date: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          last_verification_attempt?: string | null
          platform: string
          post_url: string
          status?: string
          tasks_granted?: number
          updated_at?: string
          user_id: string
          verification_attempts?: number | null
          verification_date?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          last_verification_attempt?: string | null
          platform?: string
          post_url?: string
          status?: string
          tasks_granted?: number
          updated_at?: string
          user_id?: string
          verification_attempts?: number | null
          verification_date?: string | null
        }
        Relationships: []
      }
      sso_configurations: {
        Row: {
          certificate: string | null
          configuration: Json
          created_at: string | null
          id: string
          is_active: boolean | null
          metadata_url: string | null
          organization_id: string
          provider: string
          provider_name: string
          updated_at: string | null
        }
        Insert: {
          certificate?: string | null
          configuration: Json
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          metadata_url?: string | null
          organization_id: string
          provider: string
          provider_name: string
          updated_at?: string | null
        }
        Update: {
          certificate?: string | null
          configuration?: Json
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          metadata_url?: string | null
          organization_id?: string
          provider?: string
          provider_name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sso_configurations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sso_domain_mappings: {
        Row: {
          created_at: string
          domain: string
          id: string
          is_verified: boolean
          organization_id: string
          sso_config_id: string | null
          verification_token: string | null
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          domain: string
          id?: string
          is_verified?: boolean
          organization_id: string
          sso_config_id?: string | null
          verification_token?: string | null
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          domain?: string
          id?: string
          is_verified?: boolean
          organization_id?: string
          sso_config_id?: string | null
          verification_token?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sso_domain_mappings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sso_domain_mappings_sso_config_id_fkey"
            columns: ["sso_config_id"]
            isOneToOne: false
            referencedRelation: "sso_configurations"
            referencedColumns: ["id"]
          },
        ]
      }
      sso_login_attempts: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          ip_address: unknown
          saml_request_id: string | null
          sso_config_id: string
          status: string
          user_agent: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          ip_address?: unknown
          saml_request_id?: string | null
          sso_config_id: string
          status: string
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          ip_address?: unknown
          saml_request_id?: string | null
          sso_config_id?: string
          status?: string
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sso_login_attempts_sso_config_id_fkey"
            columns: ["sso_config_id"]
            isOneToOne: false
            referencedRelation: "sso_configurations"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_processed_events: {
        Row: {
          event_created: string | null
          event_id: string
          event_type: string
          processed_at: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
        }
        Insert: {
          event_created?: string | null
          event_id: string
          event_type: string
          processed_at?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
        }
        Update: {
          event_created?: string | null
          event_id?: string
          event_type?: string
          processed_at?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
        }
        Relationships: []
      }
      stripe_tier_mapping: {
        Row: {
          created_at: string
          id: string
          stripe_price_id: string
          stripe_product_id: string | null
          tier_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          stripe_price_id: string
          stripe_product_id?: string | null
          tier_id: string
        }
        Update: {
          created_at?: string
          id?: string
          stripe_price_id?: string
          stripe_product_id?: string | null
          tier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_tier_mapping_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          billing_cycle: string | null
          cancel_at_period_end: boolean | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          default_payment_method_id: string | null
          id: string
          organization_id: string | null
          plan_id: string
          quantity: number | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          team_id: string | null
          trial_end: string | null
          trial_start: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          billing_cycle?: string | null
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          default_payment_method_id?: string | null
          id?: string
          organization_id?: string | null
          plan_id: string
          quantity?: number | null
          status: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          team_id?: string | null
          trial_end?: string | null
          trial_start?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          billing_cycle?: string | null
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          default_payment_method_id?: string | null
          id?: string
          organization_id?: string | null
          plan_id?: string
          quantity?: number | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          team_id?: string | null
          trial_end?: string | null
          trial_start?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      support_ticket_responses: {
        Row: {
          created_at: string | null
          id: string
          is_staff_response: boolean | null
          message: string | null
          ticket_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_staff_response?: boolean | null
          message?: string | null
          ticket_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_staff_response?: boolean | null
          message?: string | null
          ticket_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_responses_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          metadata: Json | null
          priority: string | null
          status: string | null
          subject: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          metadata?: Json | null
          priority?: string | null
          status?: string | null
          subject: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          metadata?: Json | null
          priority?: string | null
          status?: string | null
          subject?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      systematic_test_results: {
        Row: {
          code_hash: string | null
          duration_ms: number | null
          error_message: string | null
          node_title: string | null
          node_type: string
          provider_id: string
          status: string
          tested_at: string | null
        }
        Insert: {
          code_hash?: string | null
          duration_ms?: number | null
          error_message?: string | null
          node_title?: string | null
          node_type: string
          provider_id: string
          status?: string
          tested_at?: string | null
        }
        Update: {
          code_hash?: string | null
          duration_ms?: number | null
          error_message?: string | null
          node_title?: string | null
          node_type?: string
          provider_id?: string
          status?: string
          tested_at?: string | null
        }
        Relationships: []
      }
      task_billing_events: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          event_type: string
          execution_id: string | null
          id: string
          metadata: Json
          node_breakdown: Json
          period_end_snapshot: string | null
          period_start_snapshot: string | null
          source: string
          tasks_limit_snapshot: number
          user_id: string
          workflow_id: string | null
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          event_type: string
          execution_id?: string | null
          id?: string
          metadata?: Json
          node_breakdown?: Json
          period_end_snapshot?: string | null
          period_start_snapshot?: string | null
          source: string
          tasks_limit_snapshot: number
          user_id: string
          workflow_id?: string | null
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          event_type?: string
          execution_id?: string | null
          id?: string
          metadata?: Json
          node_breakdown?: Json
          period_end_snapshot?: string | null
          period_start_snapshot?: string | null
          source?: string
          tasks_limit_snapshot?: number
          user_id?: string
          workflow_id?: string | null
        }
        Relationships: []
      }
      task_overage_events: {
        Row: {
          amount: number
          created_at: string
          execution_id: string
          id: string
          period_end: string
          period_start: string
          rate_cents: number
          reported_to_stripe_at: string | null
          stripe_subscription_item_id: string | null
          stripe_usage_record_id: string | null
          user_id: string
          workflow_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          execution_id: string
          id?: string
          period_end: string
          period_start: string
          rate_cents: number
          reported_to_stripe_at?: string | null
          stripe_subscription_item_id?: string | null
          stripe_usage_record_id?: string | null
          user_id: string
          workflow_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          execution_id?: string
          id?: string
          period_end?: string
          period_start?: string
          rate_cents?: number
          reported_to_stripe_at?: string | null
          stripe_subscription_item_id?: string | null
          stripe_usage_record_id?: string | null
          user_id?: string
          workflow_id?: string | null
        }
        Relationships: []
      }
      team_activity: {
        Row: {
          activity_type: string
          created_at: string
          description: string
          id: string
          metadata: Json | null
          team_id: string
          user_id: string | null
        }
        Insert: {
          activity_type: string
          created_at?: string
          description: string
          id?: string
          metadata?: Json | null
          team_id: string
          user_id?: string | null
        }
        Update: {
          activity_type?: string
          created_at?: string
          description?: string
          id?: string
          metadata?: Json | null
          team_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_activity_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_invitations: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string
          invited_at: string | null
          invitee_id: string
          inviter_id: string
          responded_at: string | null
          role: string
          status: string
          team_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          invited_at?: string | null
          invitee_id: string
          inviter_id: string
          responded_at?: string | null
          role?: string
          status?: string
          team_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          invited_at?: string | null
          invitee_id?: string
          inviter_id?: string
          responded_at?: string | null
          role?: string
          status?: string
          team_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_invitations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          id: string
          joined_at: string | null
          role: string | null
          team_id: string
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string | null
          role?: string | null
          team_id: string
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string | null
          role?: string | null
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_suspension_notifications: {
        Row: {
          created_at: string
          id: string
          metadata: Json | null
          notification_type: string
          read_at: string | null
          sent_at: string
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json | null
          notification_type: string
          read_at?: string | null
          sent_at?: string
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json | null
          notification_type?: string
          read_at?: string | null
          sent_at?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_suspension_notifications_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          color: string | null
          created_at: string | null
          created_by: string
          description: string | null
          grace_period_ends_at: string | null
          id: string
          name: string
          organization_id: string | null
          settings: Json | null
          slug: string
          suspended_at: string | null
          suspension_notified_at: string | null
          suspension_reason: string | null
          tasks_limit: number | null
          tasks_used: number | null
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          created_by: string
          description?: string | null
          grace_period_ends_at?: string | null
          id?: string
          name: string
          organization_id?: string | null
          settings?: Json | null
          slug: string
          suspended_at?: string | null
          suspension_notified_at?: string | null
          suspension_reason?: string | null
          tasks_limit?: number | null
          tasks_used?: number | null
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          created_by?: string
          description?: string | null
          grace_period_ends_at?: string | null
          id?: string
          name?: string
          organization_id?: string | null
          settings?: Json | null
          slug?: string
          suspended_at?: string | null
          suspension_notified_at?: string | null
          suspension_reason?: string | null
          tasks_limit?: number | null
          tasks_used?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      template_analytics: {
        Row: {
          avg_satisfaction: number | null
          created_at: string
          disabled_reason: string | null
          failed_uses: number
          id: string
          is_active: boolean
          last_used_at: string | null
          plans_built: number
          plans_executed: number
          regeneration_requests: number
          satisfaction_count: number | null
          success_rate: number | null
          successful_uses: number
          template_id: string
          template_source: string
          total_cost_saved: number | null
          total_uses: number
          updated_at: string
        }
        Insert: {
          avg_satisfaction?: number | null
          created_at?: string
          disabled_reason?: string | null
          failed_uses?: number
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          plans_built?: number
          plans_executed?: number
          regeneration_requests?: number
          satisfaction_count?: number | null
          success_rate?: number | null
          successful_uses?: number
          template_id: string
          template_source: string
          total_cost_saved?: number | null
          total_uses?: number
          updated_at?: string
        }
        Update: {
          avg_satisfaction?: number | null
          created_at?: string
          disabled_reason?: string | null
          failed_uses?: number
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          plans_built?: number
          plans_executed?: number
          regeneration_requests?: number
          satisfaction_count?: number | null
          success_rate?: number | null
          successful_uses?: number
          template_id?: string
          template_source?: string
          total_cost_saved?: number | null
          total_uses?: number
          updated_at?: string
        }
        Relationships: []
      }
      template_assets: {
        Row: {
          asset_type: string
          asset_url: string
          created_at: string | null
          id: string
          metadata: Json | null
          template_id: string | null
        }
        Insert: {
          asset_type: string
          asset_url: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          template_id?: string | null
        }
        Update: {
          asset_type?: string
          asset_url?: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "template_assets_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id"]
          },
        ]
      }
      template_downloads: {
        Row: {
          created_at: string | null
          id: string
          organization_id: string | null
          template_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          organization_id?: string | null
          template_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          organization_id?: string | null
          template_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_downloads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      template_reviews: {
        Row: {
          created_at: string | null
          id: string
          rating: number
          review_text: string | null
          template_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          rating: number
          review_text?: string | null
          template_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          rating?: number
          review_text?: string | null
          template_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      templates: {
        Row: {
          category: string | null
          connections: Json | null
          created_at: string | null
          created_by: string | null
          description: string | null
          difficulty: string | null
          estimated_time: string | null
          id: string
          integrations: string[] | null
          is_ai_generated: boolean | null
          is_predefined: boolean | null
          is_public: boolean | null
          metadata: Json | null
          name: string
          nodes: Json | null
          original_prompt: string | null
          prompt_hash: string | null
          published_at: string | null
          status: string | null
          updated_at: string | null
          usage_count: number | null
        }
        Insert: {
          category?: string | null
          connections?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          difficulty?: string | null
          estimated_time?: string | null
          id?: string
          integrations?: string[] | null
          is_ai_generated?: boolean | null
          is_predefined?: boolean | null
          is_public?: boolean | null
          metadata?: Json | null
          name: string
          nodes?: Json | null
          original_prompt?: string | null
          prompt_hash?: string | null
          published_at?: string | null
          status?: string | null
          updated_at?: string | null
          usage_count?: number | null
        }
        Update: {
          category?: string | null
          connections?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          difficulty?: string | null
          estimated_time?: string | null
          id?: string
          integrations?: string[] | null
          is_ai_generated?: boolean | null
          is_predefined?: boolean | null
          is_public?: boolean | null
          metadata?: Json | null
          name?: string
          nodes?: Json | null
          original_prompt?: string | null
          prompt_hash?: string | null
          published_at?: string | null
          status?: string | null
          updated_at?: string | null
          usage_count?: number | null
        }
        Relationships: []
      }
      test_webhooks: {
        Row: {
          created_at: string | null
          id: string
          payload: Json | null
          workflow_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          payload?: Json | null
          workflow_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          payload?: Json | null
          workflow_id?: string
        }
        Relationships: []
      }
      token_audit_logs: {
        Row: {
          action: string
          created_at: string | null
          error: string | null
          id: string
          integration_id: string | null
          success: boolean | null
        }
        Insert: {
          action: string
          created_at?: string | null
          error?: string | null
          id?: string
          integration_id?: string | null
          success?: boolean | null
        }
        Update: {
          action?: string
          created_at?: string | null
          error?: string | null
          id?: string
          integration_id?: string | null
          success?: boolean | null
        }
        Relationships: []
      }
      token_refresh_logs: {
        Row: {
          created_at: string | null
          duration_ms: number
          error_count: number
          errors: Json | null
          executed_at: string
          failed_refreshes: number
          id: string
          is_critical_failure: boolean | null
          job_id: string | null
          skipped_refreshes: number
          status: string | null
          successful_refreshes: number
          total_processed: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          duration_ms: number
          error_count?: number
          errors?: Json | null
          executed_at: string
          failed_refreshes?: number
          id?: string
          is_critical_failure?: boolean | null
          job_id?: string | null
          skipped_refreshes?: number
          status?: string | null
          successful_refreshes?: number
          total_processed?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          duration_ms?: number
          error_count?: number
          errors?: Json | null
          executed_at?: string
          failed_refreshes?: number
          id?: string
          is_critical_failure?: boolean | null
          job_id?: string | null
          skipped_refreshes?: number
          status?: string | null
          successful_refreshes?: number
          total_processed?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      trigger_poll_state: {
        Row: {
          created_at: string
          id: string
          last_poll_time: string
          node_id: string
          updated_at: string
          workflow_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_poll_time?: string
          node_id: string
          updated_at?: string
          workflow_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_poll_time?: string
          node_id?: string
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trigger_poll_state_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      trigger_resources: {
        Row: {
          config: Json | null
          created_at: string | null
          expires_at: string | null
          external_id: string | null
          id: string
          is_test: boolean | null
          metadata: Json | null
          node_id: string | null
          provider: string
          provider_id: string | null
          resource_id: string
          resource_type: string
          status: string | null
          test_session_id: string | null
          trigger_type: string | null
          updated_at: string | null
          user_id: string
          workflow_id: string | null
        }
        Insert: {
          config?: Json | null
          created_at?: string | null
          expires_at?: string | null
          external_id?: string | null
          id?: string
          is_test?: boolean | null
          metadata?: Json | null
          node_id?: string | null
          provider: string
          provider_id?: string | null
          resource_id: string
          resource_type: string
          status?: string | null
          test_session_id?: string | null
          trigger_type?: string | null
          updated_at?: string | null
          user_id: string
          workflow_id?: string | null
        }
        Update: {
          config?: Json | null
          created_at?: string | null
          expires_at?: string | null
          external_id?: string | null
          id?: string
          is_test?: boolean | null
          metadata?: Json | null
          node_id?: string | null
          provider?: string
          provider_id?: string | null
          resource_id?: string
          resource_type?: string
          status?: string | null
          test_session_id?: string | null
          trigger_type?: string | null
          updated_at?: string | null
          user_id?: string
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trigger_resources_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      trigger_state: {
        Row: {
          check_count: number | null
          created_at: string | null
          id: string
          last_checked_at: string | null
          last_checked_value: Json | null
          trigger_type: string
          updated_at: string | null
          workflow_id: string
        }
        Insert: {
          check_count?: number | null
          created_at?: string | null
          id?: string
          last_checked_at?: string | null
          last_checked_value?: Json | null
          trigger_type: string
          updated_at?: string | null
          workflow_id: string
        }
        Update: {
          check_count?: number | null
          created_at?: string | null
          id?: string
          last_checked_at?: string | null
          last_checked_value?: Json | null
          trigger_type?: string
          updated_at?: string | null
          workflow_id?: string
        }
        Relationships: []
      }
      usage_logs: {
        Row: {
          action: string
          created_at: string | null
          id: string
          metadata: Json | null
          organization_id: string | null
          quantity: number | null
          resource_id: string | null
          resource_type: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string | null
          quantity?: number | null
          resource_id?: string | null
          resource_type: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string | null
          quantity?: number | null
          resource_id?: string | null
          resource_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_config_preferences: {
        Row: {
          created_at: string | null
          field_name: string
          field_type: string
          field_value: string | null
          id: string
          is_default: boolean | null
          node_type: string
          provider_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          field_name: string
          field_type?: string
          field_value?: string | null
          id?: string
          is_default?: boolean | null
          node_type: string
          provider_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          field_name?: string
          field_type?: string
          field_value?: string | null
          id?: string
          is_default?: boolean | null
          node_type?: string
          provider_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_entitlements: {
        Row: {
          current_period_end: string
          current_period_start: string
          id: string
          last_stripe_event_at: string | null
          last_stripe_event_id: string | null
          source: string
          status: string
          tasks_limit_snapshot: number
          tasks_used: number
          tier_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          current_period_end: string
          current_period_start: string
          id?: string
          last_stripe_event_at?: string | null
          last_stripe_event_id?: string | null
          source?: string
          status?: string
          tasks_limit_snapshot: number
          tasks_used?: number
          tier_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          current_period_end?: string
          current_period_start?: string
          id?: string
          last_stripe_event_at?: string | null
          last_stripe_event_id?: string | null
          source?: string
          status?: string
          tasks_limit_snapshot?: number
          tasks_used?: number
          tier_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_entitlements_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      user_memory_documents: {
        Row: {
          content: string | null
          created_at: string | null
          description: string | null
          doc_type: string | null
          document_type: string
          embedding: string | null
          id: string
          last_accessed_at: string | null
          metadata: Json | null
          scope: string | null
          structured_data: Json | null
          title: string | null
          updated_at: string | null
          user_id: string | null
          workflow_id: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          description?: string | null
          doc_type?: string | null
          document_type: string
          embedding?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          scope?: string | null
          structured_data?: Json | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
          workflow_id?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string | null
          description?: string | null
          doc_type?: string | null
          document_type?: string
          embedding?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          scope?: string | null
          structured_data?: Json | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
          workflow_id?: string | null
        }
        Relationships: []
      }
      user_presence: {
        Row: {
          last_seen: string | null
          metadata: Json | null
          status: string | null
          user_id: string
        }
        Insert: {
          last_seen?: string | null
          metadata?: Json | null
          status?: string | null
          user_id: string
        }
        Update: {
          last_seen?: string | null
          metadata?: Json | null
          status?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          admin: boolean | null
          admin_capabilities: Json
          auto_buy_packs: boolean
          avatar_url: string | null
          billing_period_end: string | null
          billing_period_start: string
          browser_automation_reset_at: string | null
          browser_automation_seconds_limit: number | null
          browser_automation_seconds_used: number | null
          company: string | null
          created_at: string | null
          default_openai_model: string | null
          default_workspace_id: string | null
          default_workspace_type: string | null
          email: string | null
          first_name: string | null
          full_name: string | null
          id: string
          job_title: string | null
          last_name: string | null
          locale: string | null
          notification_preferences: Json | null
          openai_api_keys: Json | null
          opt_in_v2_execution: boolean
          overage_cap_multiplier: number
          overage_enabled: boolean
          overage_tasks_used: number
          phone_number: string | null
          plan: string
          provider: string | null
          role: string | null
          secondary_email: string | null
          slack_notification_config: Json | null
          stripe_subscription_item_id: string | null
          task_pack_balance: number
          tasks_limit: number
          tasks_used: number
          timezone: string | null
          updated_at: string | null
          usage_notifications_sent: Json
          username: string | null
          workflow_creation_mode: string | null
        }
        Insert: {
          admin?: boolean | null
          admin_capabilities?: Json
          auto_buy_packs?: boolean
          avatar_url?: string | null
          billing_period_end?: string | null
          billing_period_start?: string
          browser_automation_reset_at?: string | null
          browser_automation_seconds_limit?: number | null
          browser_automation_seconds_used?: number | null
          company?: string | null
          created_at?: string | null
          default_openai_model?: string | null
          default_workspace_id?: string | null
          default_workspace_type?: string | null
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          id: string
          job_title?: string | null
          last_name?: string | null
          locale?: string | null
          notification_preferences?: Json | null
          openai_api_keys?: Json | null
          opt_in_v2_execution?: boolean
          overage_cap_multiplier?: number
          overage_enabled?: boolean
          overage_tasks_used?: number
          phone_number?: string | null
          plan?: string
          provider?: string | null
          role?: string | null
          secondary_email?: string | null
          slack_notification_config?: Json | null
          stripe_subscription_item_id?: string | null
          task_pack_balance?: number
          tasks_limit?: number
          tasks_used?: number
          timezone?: string | null
          updated_at?: string | null
          usage_notifications_sent?: Json
          username?: string | null
          workflow_creation_mode?: string | null
        }
        Update: {
          admin?: boolean | null
          admin_capabilities?: Json
          auto_buy_packs?: boolean
          avatar_url?: string | null
          billing_period_end?: string | null
          billing_period_start?: string
          browser_automation_reset_at?: string | null
          browser_automation_seconds_limit?: number | null
          browser_automation_seconds_used?: number | null
          company?: string | null
          created_at?: string | null
          default_openai_model?: string | null
          default_workspace_id?: string | null
          default_workspace_type?: string | null
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string
          job_title?: string | null
          last_name?: string | null
          locale?: string | null
          notification_preferences?: Json | null
          openai_api_keys?: Json | null
          opt_in_v2_execution?: boolean
          overage_cap_multiplier?: number
          overage_enabled?: boolean
          overage_tasks_used?: number
          phone_number?: string | null
          plan?: string
          provider?: string | null
          role?: string | null
          secondary_email?: string | null
          slack_notification_config?: Json | null
          stripe_subscription_item_id?: string | null
          task_pack_balance?: number
          tasks_limit?: number
          tasks_used?: number
          timezone?: string | null
          updated_at?: string | null
          usage_notifications_sent?: Json
          username?: string | null
          workflow_creation_mode?: string | null
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string | null
          id: string
          metadata: Json | null
        }
        Insert: {
          created_at?: string | null
          id: string
          metadata?: Json | null
        }
        Update: {
          created_at?: string | null
          id?: string
          metadata?: Json | null
        }
        Relationships: []
      }
      v2_oauth_tokens: {
        Row: {
          access_token_encrypted: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          metadata: Json | null
          provider: string
          refresh_token_encrypted: string | null
          workspace_id: string
        }
        Insert: {
          access_token_encrypted: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id: string
          metadata?: Json | null
          provider: string
          refresh_token_encrypted?: string | null
          workspace_id: string
        }
        Update: {
          access_token_encrypted?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          metadata?: Json | null
          provider?: string
          refresh_token_encrypted?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      v2_secrets: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          value_encrypted: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id: string
          name: string
          value_encrypted: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          value_encrypted?: string
          workspace_id?: string
        }
        Relationships: []
      }
      waitlist: {
        Row: {
          ai_actions_importance: string | null
          created_at: string | null
          custom_integrations: string[] | null
          email: string
          id: string
          invited_at: string | null
          name: string | null
          notes: string | null
          selected_integrations: string[] | null
          status: string | null
          updated_at: string | null
          wants_ai_actions: boolean | null
          wants_ai_assistant: boolean | null
          welcome_email_sent: boolean | null
        }
        Insert: {
          ai_actions_importance?: string | null
          created_at?: string | null
          custom_integrations?: string[] | null
          email: string
          id?: string
          invited_at?: string | null
          name?: string | null
          notes?: string | null
          selected_integrations?: string[] | null
          status?: string | null
          updated_at?: string | null
          wants_ai_actions?: boolean | null
          wants_ai_assistant?: boolean | null
          welcome_email_sent?: boolean | null
        }
        Update: {
          ai_actions_importance?: string | null
          created_at?: string | null
          custom_integrations?: string[] | null
          email?: string
          id?: string
          invited_at?: string | null
          name?: string | null
          notes?: string | null
          selected_integrations?: string[] | null
          status?: string | null
          updated_at?: string | null
          wants_ai_actions?: boolean | null
          wants_ai_assistant?: boolean | null
          welcome_email_sent?: boolean | null
        }
        Relationships: []
      }
      webhook_configs: {
        Row: {
          config: Json | null
          created_at: string | null
          events: string[] | null
          id: string
          last_triggered_at: string | null
          metadata: Json | null
          provider: string
          provider_id: string | null
          secret: string | null
          status: string | null
          trigger_type: string | null
          updated_at: string | null
          user_id: string
          webhook_url: string
          workflow_id: string | null
        }
        Insert: {
          config?: Json | null
          created_at?: string | null
          events?: string[] | null
          id?: string
          last_triggered_at?: string | null
          metadata?: Json | null
          provider: string
          provider_id?: string | null
          secret?: string | null
          status?: string | null
          trigger_type?: string | null
          updated_at?: string | null
          user_id: string
          webhook_url: string
          workflow_id?: string | null
        }
        Update: {
          config?: Json | null
          created_at?: string | null
          events?: string[] | null
          id?: string
          last_triggered_at?: string | null
          metadata?: Json | null
          provider?: string
          provider_id?: string | null
          secret?: string | null
          status?: string | null
          trigger_type?: string | null
          updated_at?: string | null
          user_id?: string
          webhook_url?: string
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_configs_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_event_logs: {
        Row: {
          created_at: string | null
          event_data: Json | null
          id: string
          webhook_id: string
        }
        Insert: {
          created_at?: string | null
          event_data?: Json | null
          id?: string
          webhook_id: string
        }
        Update: {
          created_at?: string | null
          event_data?: Json | null
          id?: string
          webhook_id?: string
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          created_at: string | null
          event_data: Json | null
          event_id: string | null
          event_type: string | null
          id: string
          payload: Json | null
          processed: boolean | null
          provider: string | null
          received_at: string | null
          request_id: string | null
          service: string | null
          status: string | null
          timestamp: string | null
          webhook_registration_id: string | null
        }
        Insert: {
          created_at?: string | null
          event_data?: Json | null
          event_id?: string | null
          event_type?: string | null
          id?: string
          payload?: Json | null
          processed?: boolean | null
          provider?: string | null
          received_at?: string | null
          request_id?: string | null
          service?: string | null
          status?: string | null
          timestamp?: string | null
          webhook_registration_id?: string | null
        }
        Update: {
          created_at?: string | null
          event_data?: Json | null
          event_id?: string | null
          event_type?: string | null
          id?: string
          payload?: Json | null
          processed?: boolean | null
          provider?: string | null
          received_at?: string | null
          request_id?: string | null
          service?: string | null
          status?: string | null
          timestamp?: string | null
          webhook_registration_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_webhook_registration_id_fkey"
            columns: ["webhook_registration_id"]
            isOneToOne: false
            referencedRelation: "webhook_registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_executions: {
        Row: {
          completed_at: string | null
          error: string | null
          id: string
          metadata: Json | null
          started_at: string | null
          status: string | null
          webhook_event_id: string | null
          workflow_id: string
        }
        Insert: {
          completed_at?: string | null
          error?: string | null
          id?: string
          metadata?: Json | null
          started_at?: string | null
          status?: string | null
          webhook_event_id?: string | null
          workflow_id: string
        }
        Update: {
          completed_at?: string | null
          error?: string | null
          id?: string
          metadata?: Json | null
          started_at?: string | null
          status?: string | null
          webhook_event_id?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_executions_webhook_event_id_fkey"
            columns: ["webhook_event_id"]
            isOneToOne: false
            referencedRelation: "webhook_events"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_logs: {
        Row: {
          created_at: string | null
          id: string
          log_level: string
          message: string | null
          metadata: Json | null
          webhook_execution_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          log_level: string
          message?: string | null
          metadata?: Json | null
          webhook_execution_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          log_level?: string
          message?: string | null
          metadata?: Json | null
          webhook_execution_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_logs_webhook_execution_id_fkey"
            columns: ["webhook_execution_id"]
            isOneToOne: false
            referencedRelation: "webhook_executions"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_registrations: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          metadata: Json | null
          provider: string
          user_id: string | null
          webhook_id: string | null
          webhook_url: string
          workflow_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          provider: string
          user_id?: string | null
          webhook_id?: string | null
          webhook_url: string
          workflow_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          provider?: string
          user_id?: string | null
          webhook_id?: string | null
          webhook_url?: string
          workflow_id?: string
        }
        Relationships: []
      }
      webhook_settings: {
        Row: {
          created_at: string | null
          description: string | null
          enabled: boolean | null
          id: string
          metadata: Json | null
          setting_key: string
          updated_at: string | null
          webhook_type: string
          webhook_url: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          enabled?: boolean | null
          id?: string
          metadata?: Json | null
          setting_key: string
          updated_at?: string | null
          webhook_type: string
          webhook_url: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          enabled?: boolean | null
          id?: string
          metadata?: Json | null
          setting_key?: string
          updated_at?: string | null
          webhook_type?: string
          webhook_url?: string
        }
        Relationships: []
      }
      workflow_activation_snapshots: {
        Row: {
          activated_at: string
          created_by: string | null
          id: string
          snapshot_json: Json
          workflow_id: string
        }
        Insert: {
          activated_at?: string
          created_by?: string | null
          id?: string
          snapshot_json: Json
          workflow_id: string
        }
        Update: {
          activated_at?: string
          created_by?: string | null
          id?: string
          snapshot_json?: Json
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_activation_snapshots_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_comments: {
        Row: {
          content: string
          created_at: string | null
          id: string
          node_id: string | null
          parent_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          updated_at: string | null
          user_email: string | null
          user_id: string
          user_name: string | null
          workflow_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          node_id?: string | null
          parent_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          updated_at?: string | null
          user_email?: string | null
          user_id: string
          user_name?: string | null
          workflow_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          node_id?: string | null
          parent_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          updated_at?: string | null
          user_email?: string | null
          user_id?: string
          user_name?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "workflow_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_comments_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_edges: {
        Row: {
          condition_expr: string | null
          created_at: string | null
          id: string
          mappings: Json | null
          metadata: Json | null
          source_node_id: string
          source_port_id: string | null
          target_node_id: string
          target_port_id: string | null
          updated_at: string | null
          user_id: string | null
          workflow_id: string
        }
        Insert: {
          condition_expr?: string | null
          created_at?: string | null
          id?: string
          mappings?: Json | null
          metadata?: Json | null
          source_node_id: string
          source_port_id?: string | null
          target_node_id: string
          target_port_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          workflow_id: string
        }
        Update: {
          condition_expr?: string | null
          created_at?: string | null
          id?: string
          mappings?: Json | null
          metadata?: Json | null
          source_node_id?: string
          source_port_id?: string | null
          target_node_id?: string
          target_port_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_edges_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_execution_sessions: {
        Row: {
          billing_scope_id: string | null
          billing_scope_type: string | null
          completed_at: string | null
          created_at: string | null
          current_step: string | null
          error_classification: Json | null
          error_message: string | null
          error_notifications_sent_at: string | null
          execution_context: Json | null
          execution_time_ms: number | null
          id: string
          input_data: Json | null
          output_data: Json | null
          parallel_branches: Json | null
          paused_at: string | null
          paused_data: Json | null
          paused_node_id: string | null
          paused_reason: string | null
          progress_percentage: number | null
          resume_data: Json | null
          retention_class: string
          root_execution_id: string | null
          session_type: string | null
          started_at: string | null
          status: string | null
          tasks_used: number | null
          test_mode: boolean | null
          trigger_data: Json | null
          updated_at: string | null
          user_id: string | null
          webhook_event_id: string | null
          workflow_definition_hash: string | null
          workflow_id: string
        }
        Insert: {
          billing_scope_id?: string | null
          billing_scope_type?: string | null
          completed_at?: string | null
          created_at?: string | null
          current_step?: string | null
          error_classification?: Json | null
          error_message?: string | null
          error_notifications_sent_at?: string | null
          execution_context?: Json | null
          execution_time_ms?: number | null
          id?: string
          input_data?: Json | null
          output_data?: Json | null
          parallel_branches?: Json | null
          paused_at?: string | null
          paused_data?: Json | null
          paused_node_id?: string | null
          paused_reason?: string | null
          progress_percentage?: number | null
          resume_data?: Json | null
          retention_class?: string
          root_execution_id?: string | null
          session_type?: string | null
          started_at?: string | null
          status?: string | null
          tasks_used?: number | null
          test_mode?: boolean | null
          trigger_data?: Json | null
          updated_at?: string | null
          user_id?: string | null
          webhook_event_id?: string | null
          workflow_definition_hash?: string | null
          workflow_id: string
        }
        Update: {
          billing_scope_id?: string | null
          billing_scope_type?: string | null
          completed_at?: string | null
          created_at?: string | null
          current_step?: string | null
          error_classification?: Json | null
          error_message?: string | null
          error_notifications_sent_at?: string | null
          execution_context?: Json | null
          execution_time_ms?: number | null
          id?: string
          input_data?: Json | null
          output_data?: Json | null
          parallel_branches?: Json | null
          paused_at?: string | null
          paused_data?: Json | null
          paused_node_id?: string | null
          paused_reason?: string | null
          progress_percentage?: number | null
          resume_data?: Json | null
          retention_class?: string
          root_execution_id?: string | null
          session_type?: string | null
          started_at?: string | null
          status?: string | null
          tasks_used?: number | null
          test_mode?: boolean | null
          trigger_data?: Json | null
          updated_at?: string | null
          user_id?: string | null
          webhook_event_id?: string | null
          workflow_definition_hash?: string | null
          workflow_id?: string
        }
        Relationships: []
      }
      workflow_files: {
        Row: {
          created_at: string | null
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          metadata: Json | null
          mime_type: string | null
          user_id: string | null
          workflow_id: string
        }
        Insert: {
          created_at?: string | null
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          metadata?: Json | null
          mime_type?: string | null
          user_id?: string | null
          workflow_id: string
        }
        Update: {
          created_at?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          metadata?: Json | null
          mime_type?: string | null
          user_id?: string | null
          workflow_id?: string
        }
        Relationships: []
      }
      workflow_folders: {
        Row: {
          color: string | null
          created_at: string | null
          description: string | null
          icon: string | null
          id: string
          is_default: boolean | null
          is_system: boolean | null
          is_trash: boolean | null
          name: string
          organization_id: string | null
          parent_folder_id: string | null
          team_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_default?: boolean | null
          is_system?: boolean | null
          is_trash?: boolean | null
          name: string
          organization_id?: string | null
          parent_folder_id?: string | null
          team_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_default?: boolean | null
          is_system?: boolean | null
          is_trash?: boolean | null
          name?: string
          organization_id?: string | null
          parent_folder_id?: string | null
          team_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_folders_parent_folder_id_fkey"
            columns: ["parent_folder_id"]
            isOneToOne: false
            referencedRelation: "workflow_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_folders_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_locks: {
        Row: {
          acquired_at: string | null
          expires_at: string | null
          id: string
          lock_type: string
          resource_id: string
          user_id: string
          workflow_id: string
        }
        Insert: {
          acquired_at?: string | null
          expires_at?: string | null
          id?: string
          lock_type: string
          resource_id: string
          user_id: string
          workflow_id: string
        }
        Update: {
          acquired_at?: string | null
          expires_at?: string | null
          id?: string
          lock_type?: string
          resource_id?: string
          user_id?: string
          workflow_id?: string
        }
        Relationships: []
      }
      workflow_nodes: {
        Row: {
          config: Json | null
          cost_hint: number | null
          created_at: string | null
          description: string | null
          display_order: number | null
          height: number | null
          id: string
          in_ports: Json | null
          io_schema: Json | null
          is_trigger: boolean | null
          label: string | null
          metadata: Json | null
          node_type: string
          out_ports: Json | null
          policy: Json | null
          position_x: number
          position_y: number
          provider_id: string | null
          title: string | null
          updated_at: string | null
          user_id: string | null
          width: number | null
          workflow_id: string
        }
        Insert: {
          config?: Json | null
          cost_hint?: number | null
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          height?: number | null
          id?: string
          in_ports?: Json | null
          io_schema?: Json | null
          is_trigger?: boolean | null
          label?: string | null
          metadata?: Json | null
          node_type: string
          out_ports?: Json | null
          policy?: Json | null
          position_x: number
          position_y: number
          provider_id?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
          width?: number | null
          workflow_id: string
        }
        Update: {
          config?: Json | null
          cost_hint?: number | null
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          height?: number | null
          id?: string
          in_ports?: Json | null
          io_schema?: Json | null
          is_trigger?: boolean | null
          label?: string | null
          metadata?: Json | null
          node_type?: string
          out_ports?: Json | null
          policy?: Json | null
          position_x?: number
          position_y?: number
          provider_id?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
          width?: number | null
          workflow_id?: string
        }
        Relationships: []
      }
      workflow_permissions: {
        Row: {
          granted_at: string
          granted_by: string | null
          id: string
          permission: string
          user_id: string
          workflow_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          permission: string
          user_id: string
          workflow_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          permission?: string
          user_id?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_permissions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_preferences: {
        Row: {
          created_at: string | null
          default_calendar_provider: string | null
          default_channels: Json | null
          default_crm_provider: string | null
          default_database_provider: string | null
          default_email_provider: string | null
          default_notification_provider: string | null
          default_spreadsheet_provider: string | null
          default_storage_provider: string | null
          id: string
          node_config_defaults: Json | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          default_calendar_provider?: string | null
          default_channels?: Json | null
          default_crm_provider?: string | null
          default_database_provider?: string | null
          default_email_provider?: string | null
          default_notification_provider?: string | null
          default_spreadsheet_provider?: string | null
          default_storage_provider?: string | null
          id?: string
          node_config_defaults?: Json | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          default_calendar_provider?: string | null
          default_channels?: Json | null
          default_crm_provider?: string | null
          default_database_provider?: string | null
          default_email_provider?: string | null
          default_notification_provider?: string | null
          default_spreadsheet_provider?: string | null
          default_storage_provider?: string | null
          id?: string
          node_config_defaults?: Json | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      workflow_prompts: {
        Row: {
          created_at: string
          detected_provider: string | null
          id: string
          llm_cost: number | null
          normalized_prompt: string
          plan_built: boolean | null
          plan_complexity: string | null
          plan_executed: boolean | null
          plan_generated: boolean
          plan_nodes: number | null
          prompt: string
          provider_category: string | null
          regenerated: boolean | null
          template_id: string | null
          template_source: string | null
          updated_at: string
          used_llm: boolean
          used_template: boolean
          user_id: string
          user_satisfaction: number | null
          workflow_id: string | null
        }
        Insert: {
          created_at?: string
          detected_provider?: string | null
          id?: string
          llm_cost?: number | null
          normalized_prompt: string
          plan_built?: boolean | null
          plan_complexity?: string | null
          plan_executed?: boolean | null
          plan_generated?: boolean
          plan_nodes?: number | null
          prompt: string
          provider_category?: string | null
          regenerated?: boolean | null
          template_id?: string | null
          template_source?: string | null
          updated_at?: string
          used_llm?: boolean
          used_template?: boolean
          user_id: string
          user_satisfaction?: number | null
          workflow_id?: string | null
        }
        Update: {
          created_at?: string
          detected_provider?: string | null
          id?: string
          llm_cost?: number | null
          normalized_prompt?: string
          plan_built?: boolean | null
          plan_complexity?: string | null
          plan_executed?: boolean | null
          plan_generated?: boolean
          plan_nodes?: number | null
          prompt?: string
          provider_category?: string | null
          regenerated?: boolean | null
          template_id?: string | null
          template_source?: string | null
          updated_at?: string
          used_llm?: boolean
          used_template?: boolean
          user_id?: string
          user_satisfaction?: number | null
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_prompts_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_snapshots: {
        Row: {
          created_at: string | null
          created_by: string
          id: string
          snapshot_data: Json
          snapshot_type: string | null
          version_id: string | null
          workflow_id: string
        }
        Insert: {
          created_at?: string | null
          created_by: string
          id?: string
          snapshot_data: Json
          snapshot_type?: string | null
          version_id?: string | null
          workflow_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string
          id?: string
          snapshot_data?: Json
          snapshot_type?: string | null
          version_id?: string | null
          workflow_id?: string
        }
        Relationships: []
      }
      workflow_tag_settings: {
        Row: {
          color: string
          created_at: string | null
          id: string
          tag_name: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string | null
          id?: string
          tag_name: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string | null
          id?: string
          tag_name?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      workflow_teams: {
        Row: {
          created_at: string | null
          role: string | null
          team_id: string
          workflow_id: string
        }
        Insert: {
          created_at?: string | null
          role?: string | null
          team_id: string
          workflow_id: string
        }
        Update: {
          created_at?: string | null
          role?: string | null
          team_id?: string
          workflow_id?: string
        }
        Relationships: []
      }
      workflow_test_sessions: {
        Row: {
          completed_at: string | null
          created_at: string | null
          ended_at: string | null
          execution_id: string | null
          expires_at: string | null
          id: string
          metadata: Json | null
          results: Json | null
          started_at: string | null
          status: string | null
          test_mode_config: Json | null
          trigger_data: Json | null
          trigger_type: string | null
          user_id: string | null
          workflow_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          ended_at?: string | null
          execution_id?: string | null
          expires_at?: string | null
          id?: string
          metadata?: Json | null
          results?: Json | null
          started_at?: string | null
          status?: string | null
          test_mode_config?: Json | null
          trigger_data?: Json | null
          trigger_type?: string | null
          user_id?: string | null
          workflow_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          ended_at?: string | null
          execution_id?: string | null
          expires_at?: string | null
          id?: string
          metadata?: Json | null
          results?: Json | null
          started_at?: string | null
          status?: string | null
          test_mode_config?: Json | null
          trigger_data?: Json | null
          trigger_type?: string | null
          user_id?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_test_sessions_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "executions"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_variables: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_secret: boolean | null
          name: string
          type: string | null
          updated_at: string | null
          value: string | null
          workflow_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_secret?: boolean | null
          name: string
          type?: string | null
          updated_at?: string | null
          value?: string | null
          workflow_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_secret?: boolean | null
          name?: string
          type?: string | null
          updated_at?: string | null
          value?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_variables_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_versions: {
        Row: {
          changes: Json | null
          created_at: string | null
          created_by: string | null
          id: string
          version_number: number
          workflow_id: string
        }
        Insert: {
          changes?: Json | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          version_number: number
          workflow_id: string
        }
        Update: {
          changes?: Json | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          version_number?: number
          workflow_id?: string
        }
        Relationships: []
      }
      workflows: {
        Row: {
          billing_scope_id: string
          billing_scope_type: string
          circuit_breaker_tripped_at: string | null
          consecutive_failure_threshold: number | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          flow_v2_enabled: boolean
          folder_id: string | null
          id: string
          last_modified_by: string | null
          max_executions_per_hour: number | null
          max_executions_per_minute: number | null
          name: string
          original_folder_id: string | null
          owner_id: string | null
          status: string | null
          tags: string[] | null
          updated_at: string | null
          user_id: string | null
          workspace_id: string | null
          workspace_type: string | null
        }
        Insert: {
          billing_scope_id: string
          billing_scope_type: string
          circuit_breaker_tripped_at?: string | null
          consecutive_failure_threshold?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          flow_v2_enabled?: boolean
          folder_id?: string | null
          id?: string
          last_modified_by?: string | null
          max_executions_per_hour?: number | null
          max_executions_per_minute?: number | null
          name: string
          original_folder_id?: string | null
          owner_id?: string | null
          status?: string | null
          tags?: string[] | null
          updated_at?: string | null
          user_id?: string | null
          workspace_id?: string | null
          workspace_type?: string | null
        }
        Update: {
          billing_scope_id?: string
          billing_scope_type?: string
          circuit_breaker_tripped_at?: string | null
          consecutive_failure_threshold?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          flow_v2_enabled?: boolean
          folder_id?: string | null
          id?: string
          last_modified_by?: string | null
          max_executions_per_hour?: number | null
          max_executions_per_minute?: number | null
          name?: string
          original_folder_id?: string | null
          owner_id?: string | null
          status?: string | null
          tags?: string[] | null
          updated_at?: string | null
          user_id?: string | null
          workspace_id?: string | null
          workspace_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflows_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "workflow_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows_revisions: {
        Row: {
          created_at: string
          graph: Json
          id: string
          published: boolean
          published_at: string | null
          published_by: string | null
          version: number
          workflow_id: string
        }
        Insert: {
          created_at?: string
          graph: Json
          id: string
          published?: boolean
          published_at?: string | null
          published_by?: string | null
          version: number
          workflow_id: string
        }
        Update: {
          created_at?: string
          graph?: Json
          id?: string
          published?: boolean
          published_at?: string | null
          published_by?: string | null
          version?: number
          workflow_id?: string
        }
        Relationships: []
      }
      workspace_memberships: {
        Row: {
          created_at: string | null
          id: string
          role: string
          updated_at: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role?: string
          updated_at?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: string
          updated_at?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_memberships_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          locale: string | null
          name: string
          owner_id: string
          settings: Json | null
          slug: string | null
          timezone: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          locale?: string | null
          name?: string
          owner_id: string
          settings?: Json | null
          slug?: string | null
          timezone?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          locale?: string | null
          name?: string
          owner_id?: string
          settings?: Json | null
          slug?: string | null
          timezone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      daily_cost_savings: {
        Row: {
          cost_saved: number | null
          date: string | null
          llm_cost_spent: number | null
          llm_uses: number | null
          template_hit_rate: number | null
          template_uses: number | null
          total_prompts: number | null
        }
        Relationships: []
      }
      template_candidates: {
        Row: {
          avg_complexity: number | null
          build_count: number | null
          frequency: number | null
          last_seen: string | null
          normalized_prompt: string | null
          providers_used: string[] | null
        }
        Relationships: []
      }
      template_performance: {
        Row: {
          execution_rate: number | null
          last_used_at: string | null
          plans_built: number | null
          plans_executed: number | null
          success_rate: number | null
          template_id: string | null
          template_source: string | null
          total_cost_saved: number | null
          total_uses: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_user_to_beta_testers: {
        Args: { user_email: string; user_notes?: string; user_status?: string }
        Returns: string
      }
      apply_stripe_period: {
        Args: {
          p_reset_tasks?: boolean
          p_stripe_period_end: string
          p_stripe_period_start: string
          p_tier_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      auto_delete_old_trash_workflows: { Args: never; Returns: undefined }
      bytea_to_text: { Args: { data: string }; Returns: string }
      call_token_refresh: { Args: never; Returns: undefined }
      can_access_workspace: {
        Args: { user_uuid?: string; workspace_uuid: string }
        Returns: boolean
      }
      can_user_admin_integration: {
        Args: { p_integration_id: string; p_user_id: string }
        Returns: boolean
      }
      can_user_manage_integration: {
        Args: { p_integration_id: string; p_user_id: string }
        Returns: boolean
      }
      can_user_use_integration: {
        Args: { p_integration_id: string; p_user_id: string }
        Returns: boolean
      }
      check_user_role_permission: {
        Args: { required_role: string; user_id: string }
        Returns: boolean
      }
      check_workflow_health: {
        Args: { workflow_id_param: string }
        Returns: {
          dependency_name: string
          health_status: string
          last_checked: string
        }[]
      }
      clean_microsoft_webhook_dedup: { Args: never; Returns: number }
      clean_microsoft_webhook_queue: { Args: never; Returns: undefined }
      cleanup_expired_invitations: { Args: never; Returns: undefined }
      cleanup_expired_tokens: { Args: never; Returns: number }
      cleanup_old_audit_logs: { Args: never; Returns: undefined }
      cleanup_old_execution_history: { Args: never; Returns: undefined }
      cleanup_old_executions: { Args: never; Returns: undefined }
      cleanup_old_notifications: { Args: never; Returns: undefined }
      cleanup_old_token_logs: { Args: never; Returns: undefined }
      cleanup_old_webhook_data: { Args: never; Returns: undefined }
      cleanup_old_webhook_events: {
        Args: { retention_days?: number }
        Returns: number
      }
      cleanup_orphaned_webhooks: { Args: never; Returns: undefined }
      cleanup_workflow_revisions: {
        Args: { keep_latest?: number; retention_days?: number }
        Returns: undefined
      }
      compute_next_period: {
        Args: {
          p_current_period_end: string
          p_current_period_start: string
          p_now?: string
        }
        Returns: {
          next_period_end: string
          next_period_start: string
        }[]
      }
      confirm_beta_tester_email: {
        Args: { user_email: string }
        Returns: undefined
      }
      create_default_workflow_folder_for_user: {
        Args: { user_email: string; user_id_param: string }
        Returns: string
      }
      create_notification: {
        Args: {
          p_action_url?: string
          p_expires_at?: string
          p_message: string
          p_metadata?: Json
          p_title: string
          p_type: string
          p_user_id: string
        }
        Returns: string
      }
      create_suspension_notification: {
        Args: {
          p_metadata?: Json
          p_notification_type: string
          p_team_id: string
          p_user_id: string
        }
        Returns: string
      }
      create_workflow_version_from_app: {
        Args: {
          p_change_summary?: string
          p_user_id: string
          p_workflow_id: string
        }
        Returns: string
      }
      create_workflow_with_revision: {
        Args: {
          p_billing_scope_id?: string
          p_billing_scope_type?: string
          p_description?: string
          p_folder_id?: string
          p_name: string
          p_status?: string
          p_user_id?: string
          p_workspace_id?: string
          p_workspace_type?: string
        }
        Returns: {
          billing_scope_id: string
          billing_scope_type: string
          circuit_breaker_tripped_at: string | null
          consecutive_failure_threshold: number | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          flow_v2_enabled: boolean
          folder_id: string | null
          id: string
          last_modified_by: string | null
          max_executions_per_hour: number | null
          max_executions_per_minute: number | null
          name: string
          original_folder_id: string | null
          owner_id: string | null
          status: string | null
          tags: string[] | null
          updated_at: string | null
          user_id: string | null
          workspace_id: string | null
          workspace_type: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "workflows"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      deduct_tasks_if_available: {
        Args: {
          p_amount: number
          p_event_type?: string
          p_execution_id?: string
          p_node_breakdown?: Json
          p_source?: string
          p_user_id: string
          p_workflow_id?: string
        }
        Returns: {
          applied: boolean
          consumed_from_overage: number
          consumed_from_pack: number
          current_tasks_limit: number
          new_tasks_used: number
          overage_rate_cents: number
          remaining: number
          result_type: string
          success: boolean
        }[]
      }
      deduct_tasks_v2: {
        Args: {
          p_amount: number
          p_event_type?: string
          p_execution_id?: string
          p_node_breakdown?: Json
          p_source?: string
          p_user_id: string
          p_workflow_id?: string
        }
        Returns: {
          applied: boolean
          current_tasks_limit: number
          new_tasks_used: number
          remaining: number
          result_type: string
          success: boolean
        }[]
      }
      empty_user_trash: { Args: { user_uuid: string }; Returns: undefined }
      expire_old_team_invitations: { Args: never; Returns: undefined }
      flow_v2_get_next_version: { Args: { p_flow_id: string }; Returns: number }
      generate_ticket_number: { Args: never; Returns: string }
      get_accessible_integrations: {
        Args: { p_provider?: string; p_user_id: string }
        Returns: {
          access_type: string
          account_name: string
          avatar_url: string
          display_name: string
          email: string
          id: string
          owner_id: string
          permission_level: string
          provider: string
          sharing_scope: string
          status: string
          username: string
          workspace_id: string
          workspace_type: string
        }[]
      }
      get_agent_chat_history: {
        Args: { p_flow_id: string; p_limit?: number; p_offset?: number }
        Returns: {
          content: string
          created_at: string
          flow_id: string
          id: string
          metadata: Json
          role: string
        }[]
      }
      get_integration_admins: {
        Args: { p_integration_id: string }
        Returns: {
          email: string
          full_name: string
          user_id: string
        }[]
      }
      get_integration_usage_stats: {
        Args: { days_back?: number; integration_id_param: string }
        Returns: {
          avg_response_time: number
          error_rate: number
          most_used_endpoint: string
          total_requests: number
        }[]
      }
      get_or_create_user_default_folder: {
        Args: { target_user_id: string }
        Returns: string
      }
      get_user_context: { Args: { user_uuid?: string }; Returns: Json }
      get_user_integration_permission: {
        Args: { p_integration_id: string; p_user_id: string }
        Returns: string
      }
      get_user_organization_role: {
        Args: { p_organization_id: string; p_user_id: string }
        Returns: string
      }
      get_user_teams: {
        Args: { user_uuid?: string }
        Returns: {
          organization_id: string
          organization_name: string
          team_id: string
          team_name: string
          team_slug: string
          team_type: string
          user_role: string
          workspace_id: string
          workspace_name: string
        }[]
      }
      get_user_workflow_permission: {
        Args: { p_user_id: string; p_workflow_id: string }
        Returns: string
      }
      get_user_workspaces: {
        Args: { user_uuid?: string }
        Returns: {
          is_owner: boolean
          role: string
          workspace_id: string
          workspace_name: string
          workspace_slug: string
        }[]
      }
      get_workflow_performance_metrics: {
        Args: { days_back?: number; workflow_id_param: string }
        Returns: {
          avg_execution_time: number
          error_count: number
          success_rate: number
          total_executions: number
        }[]
      }
      grant_workflow_permission: {
        Args: {
          p_granted_by: string
          p_permission: string
          p_user_id: string
          p_workflow_id: string
        }
        Returns: string
      }
      http: {
        Args: { request: Database["public"]["CompositeTypes"]["http_request"] }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "http_request"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_delete:
        | {
            Args: { uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { content: string; content_type: string; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      http_get:
        | {
            Args: { uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { data: Json; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      http_head: {
        Args: { uri: string }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "*"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_header: {
        Args: { field: string; value: string }
        Returns: Database["public"]["CompositeTypes"]["http_header"]
        SetofOptions: {
          from: "*"
          to: "http_header"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_list_curlopt: {
        Args: never
        Returns: {
          curlopt: string
          value: string
        }[]
      }
      http_patch: {
        Args: { content: string; content_type: string; uri: string }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "*"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_post:
        | {
            Args: { content: string; content_type: string; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { data: Json; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      http_put: {
        Args: { content: string; content_type: string; uri: string }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "*"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_reset_curlopt: { Args: never; Returns: boolean }
      http_set_curlopt: {
        Args: { curlopt: string; value: string }
        Returns: boolean
      }
      increment_beta_tester_stat: {
        Args: { increment_by?: number; stat_name: string; tester_email: string }
        Returns: undefined
      }
      increment_browser_automation_usage: {
        Args: { p_seconds: number; p_user_id: string }
        Returns: undefined
      }
      increment_memory_usage: {
        Args: { memory_id: string }
        Returns: undefined
      }
      increment_monthly_usage: {
        Args: {
          p_field: string
          p_increment: number
          p_month: number
          p_user_id: string
          p_year: number
        }
        Returns: undefined
      }
      increment_tasks_used: {
        Args: { p_increment: number; p_user_id: string }
        Returns: {
          current_tasks_limit: number
          new_tasks_used: number
        }[]
      }
      is_organization_admin: {
        Args: { p_organization_id: string; p_user_id: string }
        Returns: boolean
      }
      is_team_admin: {
        Args: { p_team_id: string; p_user_id: string }
        Returns: boolean
      }
      is_team_member: {
        Args: { check_team_id: string; check_user_id: string }
        Returns: boolean
      }
      is_workflow_admin: {
        Args: { p_user_id: string; p_workflow_id: string }
        Returns: boolean
      }
      is_workspace_member: {
        Args: { usr_id: string; ws_id: string }
        Returns: boolean
      }
      is_workspace_owner: {
        Args: { usr_id: string; ws_id: string }
        Returns: boolean
      }
      log_team_activity: {
        Args: {
          p_activity_type: string
          p_description: string
          p_metadata?: Json
          p_team_id: string
          p_user_id: string
        }
        Returns: string
      }
      log_token_event: {
        Args: {
          p_event_details?: Json
          p_event_type: string
          p_integration_id: string
          p_ip_address?: unknown
          p_provider: string
          p_user_agent?: string
          p_user_id: string
        }
        Returns: string
      }
      mark_beta_tester_converted: {
        Args: { user_email: string }
        Returns: undefined
      }
      mark_integration_used: {
        Args: { p_integration_id: string }
        Returns: boolean
      }
      move_workflow_to_trash: {
        Args: { workflow_id: string }
        Returns: undefined
      }
      permanently_delete_workflow: {
        Args: { workflow_id: string }
        Returns: undefined
      }
      refresh_tokens: { Args: never; Returns: Json }
      reset_browser_automation_usage: { Args: never; Returns: undefined }
      restore_workflow_from_trash: {
        Args: { workflow_id: string }
        Returns: undefined
      }
      revoke_workflow_permission: {
        Args: { p_user_id: string; p_workflow_id: string }
        Returns: boolean
      }
      text_to_bytea: { Args: { data: string }; Returns: string }
      trigger_cleanup: { Args: never; Returns: undefined }
      update_integration_status: {
        Args: { p_integration_id: string; p_metadata?: Json; p_status: string }
        Returns: boolean
      }
      urlencode:
        | { Args: { data: Json }; Returns: string }
        | {
            Args: { string: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.urlencode(string => bytea), public.urlencode(string => varchar). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
        | {
            Args: { string: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.urlencode(string => bytea), public.urlencode(string => varchar). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
      user_can_access_team: {
        Args: { check_team_id: string; check_user_id: string }
        Returns: boolean
      }
      user_can_edit_workflow: {
        Args: { p_user_id: string; p_workflow_id: string }
        Returns: boolean
      }
      user_has_workflow_access: {
        Args: { p_user_id: string; p_workflow_id: string }
        Returns: boolean
      }
      user_has_workflow_permission: {
        Args: {
          p_required_permission?: string
          p_user_id: string
          p_workflow_id: string
        }
        Returns: boolean
      }
      workflows_create_revision: {
        Args: {
          p_created_at: string
          p_flow_id: string
          p_graph: Json
          p_id: string
        }
        Returns: {
          created_at: string
          graph: Json
          id: string
          version: number
          workflow_id: string
        }[]
      }
      workspace_role_at_least: {
        Args: {
          required_role: string
          target_user?: string
          target_workspace: string
        }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      http_header: {
        field: string | null
        value: string | null
      }
      http_request: {
        method: unknown
        uri: string | null
        headers: Database["public"]["CompositeTypes"]["http_header"][] | null
        content_type: string | null
        content: string | null
      }
      http_response: {
        status: number | null
        content_type: string | null
        headers: Database["public"]["CompositeTypes"]["http_header"][] | null
        content: string | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

