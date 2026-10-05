import socket
import struct
import json
import os
from datetime import datetime, timezone

MASTER_IP = "51.91.101.151"
MASTER_PORT = 5254
QUERY_CMD = bytes.fromhex("010000")
CONNECT_TIMEOUT = 2.5
OUT_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'rooms.json')


def get_room_info(ip, port):
    """
    连接房间获取：房间名、当前人数、最大容量
    """
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(CONNECT_TIMEOUT)
        s.connect((ip, port))

        s.send(bytes.fromhex("09"))
        data = s.recv(1024)
        s.close()

        if len(data) > 5:
            name_part = data[1:].split(b'\x00')[0]
            room_name = name_part.decode('utf-8', errors='ignore').strip()

            max_players = data[-3]
            current_players = data[-2]

            if max_players == 0 and len(data) > len(name_part) + 3:
                remain = data[len(name_part) + 1:]
                for i in range(len(remain) - 1):
                    if remain[i] > 0 and remain[i + 1] > 0:
                        max_players = remain[i]
                        current_players = remain[i + 1]
                        break

            return room_name, current_players, max_players
    except Exception:
        pass
    return "无法获取", 0, 0


def fetch_all_rooms():
    rooms = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(5)
        s.connect((MASTER_IP, MASTER_PORT))
        s.send(QUERY_CMD)

        full_data = b""
        while True:
            chunk = s.recv(1024)
            if not chunk:
                break
            full_data += chunk
            if len(full_data) >= 6 and full_data[-6:] == b'\x00' * 6:
                break
        s.close()

        record_size = 6
        for i in range(0, len(full_data), record_size):
            chunk = full_data[i:i + record_size]
            if len(chunk) < 6 or chunk == b'\x00' * 6:
                continue

            port = struct.unpack('<H', chunk[0:2])[0]
            ip_addr = f"{chunk[2]}.{chunk[3]}.{chunk[4]}.{chunk[5]}"

            name, online, cap = get_room_info(ip_addr, port)

            rooms.append({
                "ip": ip_addr,
                "port": port,
                "name": name,
                "online": online,
                "capacity": cap
            })
    except Exception as e:
        print(f"[!] 主服务器连接失败: {e}")

    return rooms


def main():
    rooms = fetch_all_rooms()
    total_players = sum(r["online"] for r in rooms)
    active_rooms = sum(1 for r in rooms if r["name"] != "无法获取")

    result = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "totalRooms": len(rooms),
        "activeRooms": active_rooms,
        "totalPlayers": total_players,
        "rooms": rooms
    }

    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"已保存 {len(rooms)} 个房间到 {OUT_FILE}")
    print(f"活跃房间：{active_rooms} | 全服总人数：{total_players}")


if __name__ == "__main__":
    main()