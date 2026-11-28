-- 学习者开发版 · MySQL 初始化（在服务器 mysql 客户端执行）
-- mysql -uroot -p < mysql-init.sql

CREATE DATABASE IF NOT EXISTS ai_work_zd
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'zhida'@'localhost' IDENTIFIED BY '替换为强密码';
CREATE USER IF NOT EXISTS 'zhida'@'%' IDENTIFIED BY '替换为强密码';

GRANT ALL PRIVILEGES ON ai_work_zd.* TO 'zhida'@'localhost';
GRANT ALL PRIVILEGES ON ai_work_zd.* TO 'zhida'@'%';
FLUSH PRIVILEGES;
