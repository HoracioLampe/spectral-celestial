-- Spectral Celestial Complete Schema Export
-- Generated at: 2026-01-11T00:12:37.506Z
-- Includes: Tables, Columns, Primary Keys, Foreign Keys, Indexes, Unique Constraints, Check Constraints

-- ========================================
-- SEQUENCES
-- ========================================

CREATE SEQUENCE IF NOT EXISTS HolaMundo_id_seq;
CREATE SEQUENCE IF NOT EXISTS batch_transactions_id_seq;
CREATE SEQUENCE IF NOT EXISTS batches_id_seq;
CREATE SEQUENCE IF NOT EXISTS courses_id_seq;
CREATE SEQUENCE IF NOT EXISTS faucets_id_seq;
CREATE SEQUENCE IF NOT EXISTS merkle_nodes_id_seq;
CREATE SEQUENCE IF NOT EXISTS relayers_id_seq;
CREATE SEQUENCE IF NOT EXISTS users_id_seq;

-- ========================================
-- TABLES
-- ========================================

-- Table: HolaMundo
CREATE TABLE IF NOT EXISTS HolaMundo (
    id integer NOT NULL DEFAULT nextval('"HolaMundo_id_seq"'::regclass),
    PRIMARY KEY (id)
);

-- Table: batch_transactions
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

-- Table: batches
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
    metrics jsonb DEFAULT '{}'::jsonb,
    PRIMARY KEY (id)
);

-- Table: courses
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

-- Table: faucets
CREATE TABLE IF NOT EXISTS faucets (
    id integer NOT NULL DEFAULT nextval('faucets_id_seq'::regclass),
    address character varying(42) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    funder_address character varying(42),
    PRIMARY KEY (id)
);

-- Table: merkle_nodes
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

-- Table: rbac_users
CREATE TABLE IF NOT EXISTS rbac_users (
    address character varying(42) NOT NULL,
    role character varying(20) DEFAULT 'OPERATOR'::character varying,
    name character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (address)
);

-- Table: relayers
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

-- Table: session
CREATE TABLE IF NOT EXISTS session (
    sid character varying NOT NULL,
    sess json NOT NULL,
    expire timestamp without time zone NOT NULL,
    PRIMARY KEY (sid)
);

-- Table: users
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

-- ========================================
-- FOREIGN KEYS
-- ========================================

ALTER TABLE batch_transactions
    ADD CONSTRAINT batch_transactions_batch_id_fkey
    FOREIGN KEY (batch_id)
    REFERENCES batches (id);

ALTER TABLE merkle_nodes
    ADD CONSTRAINT merkle_nodes_batch_id_fkey
    FOREIGN KEY (batch_id)
    REFERENCES batches (id);

ALTER TABLE merkle_nodes
    ADD CONSTRAINT merkle_nodes_transaction_id_fkey
    FOREIGN KEY (transaction_id)
    REFERENCES batch_transactions (id);

ALTER TABLE relayers
    ADD CONSTRAINT relayers_batch_id_fkey
    FOREIGN KEY (batch_id)
    REFERENCES batches (id);

-- ========================================
-- UNIQUE CONSTRAINTS
-- ========================================

ALTER TABLE faucets
    ADD CONSTRAINT faucets_funder_address_unique
    UNIQUE (funder_address);

ALTER TABLE rbac_users
    ADD CONSTRAINT unique_address
    UNIQUE (address);

ALTER TABLE relayers
    ADD CONSTRAINT relayers_address_key
    UNIQUE (address);

ALTER TABLE users
    ADD CONSTRAINT users_dni_key
    UNIQUE (dni);

-- ========================================
-- CHECK CONSTRAINTS
-- ========================================

ALTER TABLE HolaMundo
    ADD CONSTRAINT 2200_16390_1_not_null
    CHECK id IS NOT NULL;

ALTER TABLE batch_transactions
    ADD CONSTRAINT 2200_16437_1_not_null
    CHECK id IS NOT NULL;

ALTER TABLE batches
    ADD CONSTRAINT 2200_16427_1_not_null
    CHECK id IS NOT NULL;

ALTER TABLE courses
    ADD CONSTRAINT 2200_16407_1_not_null
    CHECK id IS NOT NULL;

ALTER TABLE faucets
    ADD CONSTRAINT 2200_16560_1_not_null
    CHECK id IS NOT NULL;

ALTER TABLE faucets
    ADD CONSTRAINT 2200_16560_2_not_null
    CHECK address IS NOT NULL;

ALTER TABLE merkle_nodes
    ADD CONSTRAINT 2200_16481_1_not_null
    CHECK id IS NOT NULL;

ALTER TABLE merkle_nodes
    ADD CONSTRAINT 2200_16481_3_not_null
    CHECK hash IS NOT NULL;

ALTER TABLE merkle_nodes
    ADD CONSTRAINT 2200_16481_5_not_null
    CHECK level IS NOT NULL;

ALTER TABLE rbac_users
    ADD CONSTRAINT 2200_26157_1_not_null
    CHECK address IS NOT NULL;

ALTER TABLE relayers
    ADD CONSTRAINT 2200_16508_1_not_null
    CHECK id IS NOT NULL;

ALTER TABLE relayers
    ADD CONSTRAINT 2200_16508_3_not_null
    CHECK address IS NOT NULL;

ALTER TABLE session
    ADD CONSTRAINT 2200_26278_1_not_null
    CHECK sid IS NOT NULL;

ALTER TABLE session
    ADD CONSTRAINT 2200_26278_2_not_null
    CHECK sess IS NOT NULL;

ALTER TABLE session
    ADD CONSTRAINT 2200_26278_3_not_null
    CHECK expire IS NOT NULL;

ALTER TABLE users
    ADD CONSTRAINT 2200_16397_1_not_null
    CHECK id IS NOT NULL;

-- ========================================
-- INDEXES
-- ========================================

CREATE INDEX idx_batch_tx_batch_id ON public.batch_transactions USING btree (batch_id);
CREATE INDEX idx_batch_tx_status ON public.batch_transactions USING btree (status);
CREATE INDEX idx_batch_tx_wallet_to ON public.batch_transactions USING btree (wallet_address_to);
CREATE INDEX idx_bt_batch_id ON public.batch_transactions USING btree (batch_id);
CREATE INDEX idx_bt_batch_status ON public.batch_transactions USING btree (batch_id, status);
CREATE INDEX idx_bt_recipient ON public.batch_transactions USING btree (wallet_address_to);
CREATE INDEX idx_bt_recipient_lower ON public.batch_transactions USING btree (lower((wallet_address_to)::text));
CREATE INDEX idx_bt_status ON public.batch_transactions USING btree (status);
CREATE INDEX idx_bt_tx_hash ON public.batch_transactions USING btree (tx_hash);
CREATE INDEX idx_batches_batch_number ON public.batches USING btree (batch_number);
CREATE INDEX idx_batches_created_at_desc ON public.batches USING btree (created_at DESC);
CREATE INDEX idx_batches_created_date ON public.batches USING btree (date(created_at));
CREATE INDEX idx_batches_desc_trgm ON public.batches USING gin (description gin_trgm_ops);
CREATE INDEX idx_batches_description ON public.batches USING btree (description);
CREATE INDEX idx_batches_detail_trgm ON public.batches USING gin (detail gin_trgm_ops);
CREATE INDEX idx_batches_funder_address ON public.batches USING btree (funder_address);
CREATE INDEX idx_batches_funder_lower ON public.batches USING btree (lower((funder_address)::text));
CREATE INDEX idx_batches_number_trgm ON public.batches USING gin (batch_number gin_trgm_ops);
CREATE INDEX idx_batches_status ON public.batches USING btree (status);
CREATE INDEX idx_batches_total_usdc ON public.batches USING btree (total_usdc);
CREATE UNIQUE INDEX faucets_funder_address_unique ON public.faucets USING btree (funder_address);
CREATE INDEX idx_faucets_funder_address_lower ON public.faucets USING btree (lower((funder_address)::text));
CREATE UNIQUE INDEX unique_address ON public.rbac_users USING btree (address);
CREATE INDEX idx_relayers_last_balance ON public.relayers USING btree (last_balance);
CREATE INDEX idx_relayers_last_balance_numeric ON public.relayers USING btree (((last_balance)::numeric)) WHERE ((last_balance)::text ~ '^[0-9.]+$'::text);
CREATE UNIQUE INDEX relayers_address_key ON public.relayers USING btree (address);
CREATE INDEX "IDX_session_expire" ON public.session USING btree (expire);
CREATE UNIQUE INDEX users_dni_key ON public.users USING btree (dni);

-- ========================================
-- END OF SCHEMA
-- ========================================
