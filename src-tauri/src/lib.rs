//! logseq-rs library entry point.
//!
//! Top-level crate wiring: exposes modules and registers Tauri commands.

pub mod error;
pub mod model;
pub mod parser;
pub mod query;
pub mod storage;
pub mod graph;
pub mod commands;
pub mod encryption;
pub mod comments;
pub mod backup;
pub mod ai;
pub mod search_index;
pub mod state;
pub mod watcher;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,logseq_rs_lib=debug".into()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::graph::open_graph,
            commands::graph::close_graph,
            commands::graph::current_graph,
            commands::graph::list_graphs,
            commands::graph::graph_stats,
            commands::graph::reload_graph,
            commands::graph::default_graph_dir,
            commands::page::list_pages,
            commands::page::get_page,
            commands::page::create_page,
            commands::page::delete_page,
            commands::page::rename_page,
            commands::page::set_page_aliases,
            commands::page::resolve_page,
            commands::block::get_block,
            commands::block::update_block,
            commands::block::insert_block,
            commands::block::delete_block,
            commands::block::move_block,
            commands::history::block_history,
            commands::history::restore_block_version,
            commands::encryption::encryption_status,
            commands::encryption::enable_encryption,
            commands::encryption::unlock_encryption,
            commands::encryption::lock_encryption,
            commands::encryption::change_encryption_passphrase,
            commands::encryption::disable_encryption,
            commands::comments::list_block_comments,
            commands::comments::list_open_comments,
            commands::comments::comment_counts,
            commands::comments::add_comment,
            commands::comments::update_comment,
            commands::comments::resolve_comment,
            commands::comments::delete_comment,
            commands::backup::list_backups,
            commands::backup::backup_config,
            commands::backup::set_backup_config,
            commands::backup::create_backup,
            commands::backup::delete_backup,
            commands::backup::restore_backup,
            commands::backup::last_backup_at,
            commands::ai::ai_config,
            commands::ai::set_ai_config,
            commands::ai::ai_complete,
            commands::ai::ai_complete_stream,
            commands::search::search,
            commands::search::semantic_search,
            commands::search::similar_blocks,
            commands::search::rebuild_search_index,
            commands::search::backlinks,
            commands::query::run_query,
            commands::query::parse_query,
            commands::journal::today_journal,
            commands::journal::list_journals,
            commands::journal::cycle_task,
            commands::journal::set_task,
            commands::journal::open_tasks,
            commands::journal::journal_for_date,
            commands::journal::calendar_summary,
            commands::journal::blocks_for_date,
            commands::journal::agenda,
            commands::whiteboard::list_whiteboards,
            commands::whiteboard::get_whiteboard,
            commands::whiteboard::create_whiteboard,
            commands::whiteboard::save_whiteboard,
            commands::whiteboard::delete_whiteboard,
            commands::whiteboard::rename_whiteboard,
            commands::transfer::export_markdown,
            commands::transfer::export_json,
            commands::transfer::import_markdown,
            commands::transfer::import_markdown_file,
            commands::transfer::import_json,
            commands::transfer::export_opml,
            commands::transfer::import_opml,
            commands::transfer::export_page_markdown,
            commands::template::list_templates,
            commands::template::template_variables,
            commands::template::insert_template,
            commands::references::backlinks_grouped,
            commands::references::block_refs,
            commands::references::block_context,
            commands::dashboard::dashboard_stats,
            commands::marketplace::fetch_marketplace,
            commands::marketplace::install_plugin_from_url,
            commands::assets::import_image_bytes,
            commands::assets::import_audio_bytes,
            commands::assets::read_asset_bytes,
            commands::pdf::import_pdf,
            commands::pdf::import_pdf_bytes,
            commands::pdf::list_pdfs,
            commands::pdf::read_pdf_bytes,
            commands::pdf::delete_pdf,
            commands::pdf::list_pdf_annotations,
            commands::pdf::save_pdf_annotations,
            commands::pdf::import_zotero_bibtex,
            commands::clipper::receive_clip,
            commands::plugin::list_plugins,
            commands::plugin::install_plugin,
            commands::plugin::install_bundled_plugin,
            commands::plugin::uninstall_plugin,
            commands::plugin::set_plugin_enabled,
            commands::plugin::read_plugin_main,
            commands::update::app_version,
            commands::update::check_for_update,
            commands::update::install_update,
        ])
        .setup(|app| {
            // Start the local HTTP receiver for Web Clipper requests on
            // 127.0.0.1:33333. Bind failures are non-fatal — the
            // `quanshiwei://` deep-link path keeps working.
            commands::clip_http::spawn(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
