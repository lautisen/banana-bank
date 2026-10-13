import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
let instance: Database.Database | undefined;
export function appDb() {
  if (!instance) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    instance = new Database(path.join(config.dataDir, 'app.sqlite'));
    instance.pragma('journal_mode = WAL');
    instance.pragma('foreign_keys = ON');
    instance.pragma('busy_timeout = 5000');
    instance.exec(`
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,title TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),role TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL,run_id TEXT);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,conversation_id TEXT,started_at TEXT NOT NULL,status TEXT NOT NULL,error TEXT);
      CREATE TABLE IF NOT EXISTS intents(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,conversation_id TEXT,run_id TEXT,payload TEXT NOT NULL,status TEXT NOT NULL,bank_reference TEXT,operation_id TEXT,error TEXT,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,intent_id TEXT NOT NULL,payload TEXT NOT NULL,expires_at TEXT NOT NULL,consumed_at TEXT);
      CREATE TABLE IF NOT EXISTS incidents(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,conversation_id TEXT NOT NULL,summary TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,user_id TEXT NOT NULL,conversation_id TEXT,kind TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chunks(id TEXT PRIMARY KEY,document_id TEXT NOT NULL,text TEXT NOT NULL,title TEXT,version INTEGER,valid_from TEXT,valid_to TEXT,audience TEXT NOT NULL,vector BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS embedding_cache(key TEXT PRIMARY KEY,vector BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS ulises_rules(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,label TEXT NOT NULL,when_json TEXT NOT NULL,hold_minutes INTEGER NOT NULL,trusted_contact TEXT,created_at TEXT NOT NULL,removal_requested_at TEXT,removal_effective_at TEXT);
      CREATE TABLE IF NOT EXISTS ulises_assessments(approval_id TEXT PRIMARY KEY,intent_id TEXT NOT NULL,user_id TEXT NOT NULL,conversation_id TEXT,data TEXT NOT NULL,hold_until TEXT,requires_ack INTEGER NOT NULL,acknowledged_at TEXT,incident_id TEXT,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ulises_profiles(user_id TEXT PRIMARY KEY,data TEXT,completed_at TEXT,pending TEXT,pending_effective_at TEXT,draft TEXT,draft_updated_at TEXT);
      CREATE TABLE IF NOT EXISTS ai_usage(user_id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversation_reads(conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),read_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS case_reads(incident_id TEXT PRIMARY KEY,read_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS ulises_rules_user ON ulises_rules(user_id);
      CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id,created_at);
      CREATE INDEX IF NOT EXISTS incidents_user ON incidents(user_id);
      CREATE INDEX IF NOT EXISTS events_conversation ON events(conversation_id,created_at);
    `);
  }
  return instance;
}
export function closeAppDb() {
  instance?.close();
  instance = undefined;
}
