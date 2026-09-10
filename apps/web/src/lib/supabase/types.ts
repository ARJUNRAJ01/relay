// Generated from the Supabase project schema. Regenerate with:
//   supabase gen types typescript --project-id ejpusaqqhhmpazmbvymo > src/lib/supabase/types.ts
// Do not hand-edit.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          fired_at: string
          id: string
          kind: string
          payload: Json
          transport_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          fired_at?: string
          id?: string
          kind: string
          payload: Json
          transport_id: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          fired_at?: string
          id?: string
          kind?: string
          payload?: Json
          transport_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_transport_id_fkey"
            columns: ["transport_id"]
            isOneToOne: false
            referencedRelation: "transports"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor: string
          after: Json | null
          at: string
          before: Json | null
          id: string
          transport_id: string | null
        }
        Insert: {
          action: string
          actor: string
          after?: Json | null
          at?: string
          before?: Json | null
          id?: string
          transport_id?: string | null
        }
        Update: {
          action?: string
          actor?: string
          after?: Json | null
          at?: string
          before?: Json | null
          id?: string
          transport_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_transport_id_fkey"
            columns: ["transport_id"]
            isOneToOne: false
            referencedRelation: "transports"
            referencedColumns: ["id"]
          },
        ]
      }
      device_events: {
        Row: {
          confidence: number
          detected_at: string
          id: string
          kind: string
          transport_id: string
          value: Json
        }
        Insert: {
          confidence: number
          detected_at?: string
          id?: string
          kind: string
          transport_id: string
          value: Json
        }
        Update: {
          confidence?: number
          detected_at?: string
          id?: string
          kind?: string
          transport_id?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "device_events_transport_id_fkey"
            columns: ["transport_id"]
            isOneToOne: false
            referencedRelation: "transports"
            referencedColumns: ["id"]
          },
        ]
      }
      hospitals: {
        Row: {
          created_at: string
          id: string
          name: string
          timezone: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          timezone?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          timezone?: string
        }
        Relationships: []
      }
      incidents: {
        Row: {
          closed_at: string | null
          id: string
          kind: string
          name: string
          opened_at: string
        }
        Insert: {
          closed_at?: string | null
          id?: string
          kind: string
          name: string
          opened_at?: string
        }
        Update: {
          closed_at?: string | null
          id?: string
          kind?: string
          name?: string
          opened_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          hospital_id: string | null
          id: string
          role: string
          unit_id: string | null
        }
        Insert: {
          created_at?: string
          full_name: string
          hospital_id?: string | null
          id: string
          role: string
          unit_id?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string
          hospital_id?: string | null
          id?: string
          role?: string
          unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      report_claims: {
        Row: {
          confidence: number
          created_at: string
          field: string
          human_override: Json | null
          id: string
          report_id: string
          source_segment_ids: string[]
          value: Json
        }
        Insert: {
          confidence: number
          created_at?: string
          field: string
          human_override?: Json | null
          id?: string
          report_id: string
          source_segment_ids?: string[]
          value: Json
        }
        Update: {
          confidence?: number
          created_at?: string
          field?: string
          human_override?: Json | null
          id?: string
          report_id?: string
          source_segment_ids?: string[]
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "report_claims_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          fhir_payload: Json | null
          generated_at: string
          id: string
          signed_at: string | null
          signed_by: string | null
          soap: Json
          transport_id: string
          version: number
        }
        Insert: {
          fhir_payload?: Json | null
          generated_at?: string
          id?: string
          signed_at?: string | null
          signed_by?: string | null
          soap: Json
          transport_id: string
          version: number
        }
        Update: {
          fhir_payload?: Json | null
          generated_at?: string
          id?: string
          signed_at?: string | null
          signed_by?: string | null
          soap?: Json
          transport_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "reports_signed_by_fkey"
            columns: ["signed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_transport_id_fkey"
            columns: ["transport_id"]
            isOneToOne: false
            referencedRelation: "transports"
            referencedColumns: ["id"]
          },
        ]
      }
      transcript_segments: {
        Row: {
          confidence: number
          created_at: string
          id: string
          language: string
          original_text: string
          speaker: string
          t_end: number
          t_start: number
          text: string
          transport_id: string
        }
        Insert: {
          confidence: number
          created_at?: string
          id?: string
          language?: string
          original_text: string
          speaker: string
          t_end: number
          t_start: number
          text: string
          transport_id: string
        }
        Update: {
          confidence?: number
          created_at?: string
          id?: string
          language?: string
          original_text?: string
          speaker?: string
          t_end?: number
          t_start?: number
          text?: string
          transport_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transcript_segments_transport_id_fkey"
            columns: ["transport_id"]
            isOneToOne: false
            referencedRelation: "transports"
            referencedColumns: ["id"]
          },
        ]
      }
      transports: {
        Row: {
          acuity: number | null
          created_at: string
          eta: string | null
          hospital_id: string
          id: string
          incident_id: string | null
          started_at: string
          status: string
          unit_id: string
        }
        Insert: {
          acuity?: number | null
          created_at?: string
          eta?: string | null
          hospital_id: string
          id?: string
          incident_id?: string | null
          started_at?: string
          status?: string
          unit_id: string
        }
        Update: {
          acuity?: number | null
          created_at?: string
          eta?: string | null
          hospital_id?: string
          id?: string
          incident_id?: string | null
          started_at?: string
          status?: string
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transports_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transports_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transports_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          callsign: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          callsign: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          callsign?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">
type DefaultSchema = DatabaseWithoutInternals["public"]

export type Tables<
  TableName extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]),
> = (DefaultSchema["Tables"] & DefaultSchema["Views"])[TableName] extends {
  Row: infer R
}
  ? R
  : never

export type TablesInsert<TableName extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][TableName] extends { Insert: infer I } ? I : never

export type TablesUpdate<TableName extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][TableName] extends { Update: infer U } ? U : never
