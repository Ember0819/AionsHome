"""Task attachments are served by authenticated routes, never public mounts."""
import shutil
from pathlib import Path
from repair_store import uid

MAX_FILE_BYTES = 50 * 1024 * 1024


def export_file(store, task_id, source):
    source = Path(source).expanduser().resolve(strict=True)
    if not source.is_file():
        raise ValueError("只能领取单个文件。")
    if source.stat().st_size > MAX_FILE_BYTES:
        raise ValueError("单个附件上限为 50 MB。")
    file_id = uid()
    folder = store.directory / "files"
    folder.mkdir(exist_ok=True)
    target = folder / file_id
    shutil.copyfile(source, target)
    with store.connect() as db:
        db.execute("INSERT INTO files(id,task_id,name,path,size) VALUES(?,?,?,?,?)",
                   (file_id, task_id, source.name, str(target), target.stat().st_size))
    return {"id": file_id, "name": source.name, "size": target.stat().st_size,
            "url": f"/api/repair/files/{file_id}"}


def file_record(store, file_id, task_id=None):
    with store.connect() as db:
        row = db.execute("SELECT * FROM files WHERE id=?", (file_id,)).fetchone()
    if not row or (task_id and row["task_id"] != task_id):
        raise KeyError(file_id)
    record = dict(row)
    path = Path(record["path"]).resolve(strict=True)
    if not path.is_relative_to((store.directory / "files").resolve()):
        raise ValueError("附件路径无效。")
    return record
