"""
LLM service entrypoint.
"""
import os
import sys
import subprocess
from pathlib import Path

ENV = os.getenv("ENV", "dev")


def log_error(e):
    """Log import/startup errors."""
    print(f"\n[ERROR] Import error: {e}", file=sys.stderr, flush=True)
    print("[ERROR] This usually indicates a missing dependency or misconfigured path", file=sys.stderr, flush=True)
    print("[ERROR] Check that all required modules are installed and paths are correct\n", file=sys.stderr, flush=True)


def import_traceback_print():
    """Print traceback and exit."""
    import traceback
    traceback.print_exc()
    sys.exit(1)


def start_server():
    """Start the FastAPI server process."""
    try:
        return subprocess.Popen([sys.executable, "-m", "src.server"])
    except ImportError as e:
        log_error(e)
        import_traceback_print()
    except Exception as e:
        print(f"\n[ERROR] Unexpected error during startup: {e}", file=sys.stderr, flush=True)
        import_traceback_print()


def main():
    """Main entrypoint."""
    if ENV == "production":
        try:
            from src.server import serve
            serve()
        except ImportError as e:
            log_error(e)
            import_traceback_print()
        except Exception as e:
            print(f"\n[ERROR] Unexpected error during startup: {e}", file=sys.stderr, flush=True)
            import_traceback_print()
    else:
        # Development: run with auto-restart on file changes
        print("[INFO] Starting LLM service in development mode...")
        print("[INFO] Auto-restart enabled: Any .py file save will restart the process.")
        print("[INFO] Note: Model reloads from disk on each restart.\n")

        try:
            from watchdog.observers import Observer
            from watchdog.events import FileSystemEventHandler

            class ServerRestartHandler(FileSystemEventHandler):
                """Auto-restart handler for development."""

                def __init__(self, process):
                    self.process = process
                    super().__init__()

                def on_modified(self, event):
                    if event.src_path.endswith('.py'):
                        print(f"\n[INFO] File changed: {event.src_path}")
                        print("[INFO] Restarting server...\n")
                        self.process.terminate()
                        self.process.wait()
                        self.process = start_server()

                def update_process(self, process):
                    self.process = process

            process = start_server()
            handler = ServerRestartHandler(process)
            observer = Observer()

            # Watch the src directory for changes
            watch_path = Path(__file__).parent
            observer.schedule(handler, str(watch_path), recursive=True)
            observer.start()

            try:
                process.wait()
            except KeyboardInterrupt:
                print("\n[INFO] Shutting down...")
                observer.stop()
                process.terminate()

            observer.join()

        except ImportError:
            # watchdog not installed, run without auto-restart
            print("[WARN] watchdog not installed, running without auto-restart")
            from src.server import serve
            serve()


if __name__ == "__main__":
    main()
