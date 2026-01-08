-- Spectral Celestial Schema Export
-- Generated at: 2026-01-01T18:41:55.725Z

CREATE TABLE IF NOT EXISTS HolaMundo (
    id integer NOT NULL DEFAULT nextval('"HolaMundo_id_seq"'::regclass),
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS batch_transactions (
    id integer NOT NULL DEFAULT nextval('batch_transactions_id_seq'::regclass),
    batch_id integer,
    wallet_address_to character varying(100),
    amount_usdc numeric,
    tx_hash character varying(100),
    status character varying(20) DEFAULT 'PENDING'::character varying,
    transaction_reference character varying(100),
    relayer_address character varying(42),
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    amount_transferred character varying(255),
    retry_count integer DEFAULT 0,
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS batches (
    id integer NOT NULL DEFAULT nextval('batches_id_seq'::regclass),
    batch_number character varying(50),
    detail text,
    description text,
    scheduled_date character varying(50),
    start_time character varying(50),
    end_time character varying(50),
    total_usdc numeric,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    total_transactions integer DEFAULT 0,
    sent_transactions integer DEFAULT 0,
    status character varying(20) DEFAULT 'PREPARING'::character varying,
    funder_address character varying(100),
    merkle_root character varying(66),
    updated_at timestamp without time zone DEFAULT now(),
    total_gas_used character varying(50),
    execution_time character varying(50),
    funding_amount numeric DEFAULT 0,
    refund_amount numeric DEFAULT 0,
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS courses (
    id integer NOT NULL DEFAULT nextval('courses_id_seq'::regclass),
    nombre character varying(150),
    descripcion text,
    nivel character varying(50),
    fecha_inicio date,
    duracion_semanas integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS faucets (
    id integer NOT NULL DEFAULT nextval('faucets_id_seq'::regclass),
    address character varying(42) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS merkle_nodes (
    id integer NOT NULL DEFAULT nextval('merkle_nodes_id_seq'::regclass),
    batch_id integer,
    hash character varying(66) NOT NULL,
    parent_hash character varying(66),
    level integer NOT NULL,
    transaction_id integer,
    is_leaf boolean DEFAULT false,
    position_index integer,
    verified_on_chain boolean DEFAULT false,
    verification_timestamp timestamp without time zone,
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS relayers (
    id integer NOT NULL DEFAULT nextval('relayers_id_seq'::regclass),
    batch_id integer,
    address character varying(42) NOT NULL,
    total_managed numeric DEFAULT 0,
    status character varying(20) DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    last_activity timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    last_balance character varying(50) DEFAULT '0'::character varying,
    transactionhash_deposit character varying(66) DEFAULT NULL::character varying,
    gas_cost character varying(50),
    drain_balance character varying(50),
    vault_status character varying(10) DEFAULT 'pending'::character varying,
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS transactions (
    id integer NOT NULL DEFAULT nextval('transactions_id_seq'::regclass),
    tx_hash character varying(66) NOT NULL,
    from_address character varying(42) NOT NULL,
    to_address character varying(42) NOT NULL,
    amount character varying(50) NOT NULL,
    timestamp timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    gas_used character varying(50),
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS users (
    id integer NOT NULL DEFAULT nextval('users_id_seq'::regclass),
    nombre character varying(100),
    apellido character varying(100),
    dni character varying(20),
    edad integer,
    sexo character varying(20),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
) WITH (OIDS=FALSE);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
