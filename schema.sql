-- Skip-Bo multiplayer schema
-- Run with: mysql -u <user> -p < schema.sql

CREATE DATABASE IF NOT EXISTS skipbo
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE skipbo;

-- Guest players, identified by their express-session id.
CREATE TABLE IF NOT EXISTS players (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  display_name VARCHAR(40) NOT NULL,
  session_id VARCHAR(191) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_players_session_id (session_id)
) ENGINE=InnoDB;

-- One row per game room.
CREATE TABLE IF NOT EXISTS games (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  room_code CHAR(5) NOT NULL,
  host_player_id INT UNSIGNED NOT NULL,
  status ENUM('lobby', 'active', 'finished') NOT NULL DEFAULT 'lobby',
  max_players TINYINT UNSIGNED NOT NULL DEFAULT 4,
  current_turn_seat TINYINT UNSIGNED DEFAULT NULL,
  winner_player_id INT UNSIGNED DEFAULT NULL,
  turn_timer_seconds SMALLINT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_games_room_code (room_code),
  CONSTRAINT fk_games_host FOREIGN KEY (host_player_id) REFERENCES players(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_games_winner FOREIGN KEY (winner_player_id) REFERENCES players(id)
    ON DELETE SET NULL
) ENGINE=InnoDB;

-- Seat assignments within a game.
CREATE TABLE IF NOT EXISTS game_players (
  game_id INT UNSIGNED NOT NULL,
  player_id INT UNSIGNED NOT NULL,
  seat TINYINT UNSIGNED NOT NULL,
  connected BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (game_id, player_id),
  UNIQUE KEY uq_game_players_seat (game_id, seat),
  CONSTRAINT fk_game_players_game FOREIGN KEY (game_id) REFERENCES games(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_game_players_player FOREIGN KEY (player_id) REFERENCES players(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- Full serialized game state, checkpointed after every move so games
-- survive a server restart. The in-memory copy is authoritative while the
-- process is up; this table is the persistent backup.
CREATE TABLE IF NOT EXISTS game_state (
  game_id INT UNSIGNED NOT NULL PRIMARY KEY,
  state_json JSON NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_game_state_game FOREIGN KEY (game_id) REFERENCES games(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- Append-only move history for auditing / replay.
CREATE TABLE IF NOT EXISTS moves (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  game_id INT UNSIGNED NOT NULL,
  player_id INT UNSIGNED NOT NULL,
  move_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_moves_game FOREIGN KEY (game_id) REFERENCES games(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_moves_player FOREIGN KEY (player_id) REFERENCES players(id)
    ON DELETE CASCADE,
  KEY idx_moves_game_id (game_id)
) ENGINE=InnoDB;

-- express-mysql-session expects a `sessions` table; this matches its
-- default schema (see node_modules/express-mysql-session/schema.sql).
CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  expires INT(11) UNSIGNED NOT NULL,
  data MEDIUMTEXT COLLATE utf8mb4_bin,
  PRIMARY KEY (session_id)
) ENGINE=InnoDB;
