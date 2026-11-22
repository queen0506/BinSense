import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

const SUPABASE_URL = 'https://aldudtfxldlzmlkckhol.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFsZHVkdGZ4bGRsem1sa2NraG9sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMjMyNjMsImV4cCI6MjEwMjc5OTI2M30.BU2knrw_uzmnL7tPvocSNm5OYVbr0U-bTE9doRDk2gU' 

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)