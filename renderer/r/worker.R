#!/usr/bin/env Rscript

script_arg <- sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1])
script_path <- normalizePath(script_arg, mustWork = TRUE)
renderer_dir <- dirname(script_path)
module_dir <- file.path(renderer_dir, "R")
for (module in sort(list.files(module_dir, pattern = "[.]R$", full.names = TRUE))) {
  sys.source(module, envir = .GlobalEnv)
}

read_request <- function() {
  input <- file("stdin", open = "r")
  on.exit(close(input), add = TRUE)
  text <- paste(readLines(input, warn = FALSE), collapse = "\n")
  if (!nzchar(text)) stop("Worker received an empty request.", call. = FALSE)
  jsonlite::fromJSON(text, simplifyVector = FALSE)
}

as_character_vector <- function(value, default = character()) {
  if (is.null(value) || length(value) == 0L) return(default)
  output <- as.character(unlist(value, use.names = FALSE))
  if (length(output) == 0L) default else output
}

as_integer_vector <- function(value) {
  if (is.null(value)) return(NULL)
  output <- suppressWarnings(as.integer(unlist(value, use.names = FALSE)))
  output[!is.na(output)]
}

inspect_input <- function(params) {
  renderer_assert_core_dependencies()
  spec <- params$spec
  tree_obj <- load_tree(
    tree_path = spec$tree,
    fasta_path = spec$fasta,
    dist_path = spec$dist,
    outgroup = as_character_vector(spec$outgroup, NULL),
    sequence_type = as.character(spec$sequence_type %||% "auto"),
    repair_tip_labels = isTRUE(spec$repair_tip_labels)
  )
  metadata <- if (is.null(spec$metadata)) NULL else .read_tree_table(spec$metadata)
  columns <- if (is.null(metadata)) list() else lapply(names(metadata), function(name) {
    values <- metadata[[name]]
    numeric_values <- suppressWarnings(as.numeric(values))
    numeric_fraction <- if (length(values)) mean(!is.na(numeric_values)) else 0
    list(
      name = name,
      type = if (is.numeric(values) || numeric_fraction > 0.9) "numeric" else "categorical",
      non_missing = sum(!is.na(values) & nzchar(as.character(values))),
      unique = length(unique(values[!is.na(values)])),
      tip_matches = sum(as.character(values) %in% tree_obj$tip_labels),
      minimum = if (numeric_fraction > 0.9) min(numeric_values, na.rm = TRUE) else NULL,
      maximum = if (numeric_fraction > 0.9) max(numeric_values, na.rm = TRUE) else NULL
    )
  })
  list(
    ok = TRUE,
    method = "input.inspect",
    tree = list(
      tips = tree_obj$n_tips,
      internal_nodes = tree_obj$n_nodes,
      rooted = tree_obj$rooted,
      route = tree_obj$route,
      tip_labels = as.list(head(tree_obj$tip_labels, 20))
    ),
    metadata = list(rows = if (is.null(metadata)) 0L else nrow(metadata), columns = columns)
  )
}

render_run <- function(params) {
  renderer_assert_core_dependencies()
  spec <- params$spec
  output_dir <- normalizePath(params$output_dir, mustWork = FALSE)
  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)

  tree_obj <- load_tree(
    tree_path = spec$tree,
    fasta_path = spec$fasta,
    dist_path = spec$dist,
    outgroup = as_character_vector(spec$outgroup, NULL),
    sequence_type = as.character(spec$sequence_type %||% "auto"),
    repair_tip_labels = isTRUE(spec$repair_tip_labels)
  )
  result <- run_analysis(
    tree_obj,
    layout = as_character_vector(spec$layouts, c("rectangular", "circular")),
    intents = as_character_vector(spec$intents, NULL),
    group_by = spec$groups,
    metadata_by = spec$metadata,
    tip_column = spec$tip_column,
    group_column = spec$group_column,
    size_column = spec$size_column,
    shape_column = spec$shape_column,
    heatmap_columns = as_character_vector(spec$heatmap_columns, NULL),
    heatmap_width = as.numeric(spec$heatmap_width %||% 0.34),
    layout_overrides = spec$layout_overrides %||% list(),
    tip_labels = as.character(spec$tip_labels %||% "auto"),
    palette = as.character(spec$palette %||% "colorblind"),
    plot_theme = as.character(spec$plot_theme %||% "publication"),
    clade_nodes = as_integer_vector(spec$clade_nodes),
    clade_labels = as_character_vector(spec$clade_labels, NULL),
    support_var = spec$support_var
  )
  feedback_result <- apply_feedback_overlays(result, params$feedback)
  result <- feedback_result$result
  generate_all_plots(
    result,
    output_dir = output_dir,
    width = as.numeric(spec$render$width %||% 10),
    height = as.numeric(spec$render$height %||% 8),
    dpi = as.numeric(spec$render$dpi %||% 180),
    format = as_character_vector(spec$render$formats, "png")
  )
  export_all(result, output_dir = output_dir)
  scene_path <- extract_scene(result, output_dir = output_dir)
  feedback_path <- file.path(output_dir, "feedback_status.json")
  ggtree_air_write_json(list(
    schema_version = "1.0.0",
    source_scene_id = params$feedback$scene_id %||% NULL,
    items = feedback_result$status
  ), feedback_path)

  files <- list.files(output_dir, full.names = TRUE)
  list(
    ok = TRUE,
    method = "render.run",
    renderer = list(name = "ggtree-air-r", version = "0.1.0", r = R.version.string),
    scene = basename(scene_path),
    files = lapply(files, function(path) list(
      path = basename(path), bytes = unname(file.info(path)$size), md5 = ggtree_air_md5(path)
    ))
  )
}

request <- NULL
response <- NULL
exit_status <- 0L
sink(stderr(), type = "output")
response <- tryCatch({
  request <- read_request()
  if (!identical(request$jsonrpc, "2.0")) {
    stop("Worker request must use JSON-RPC 2.0.", call. = FALSE)
  }
  method <- as.character(request$method %||% "")
  if (identical(method, "dependencies.check")) {
    list(ok = TRUE, method = method, packages = renderer_dependency_status())
  } else if (identical(method, "input.inspect")) {
    inspect_input(request$params)
  } else if (identical(method, "render.run")) {
    render_run(request$params)
  } else {
    stop("Unknown worker method: ", method, call. = FALSE)
  }
}, error = function(error) {
  exit_status <<- 1L
  list(ok = FALSE, error = list(
    code = "R_WORKER_ERROR",
    message = conditionMessage(error),
    call = if (is.null(conditionCall(error))) NULL else deparse(conditionCall(error))
  ))
})
sink(type = "output")
wire_response <- if (isTRUE(response$ok)) {
  list(jsonrpc = "2.0", id = request$id %||% NULL, result = response)
} else {
  list(jsonrpc = "2.0", id = if (is.null(request)) NULL else request$id %||% NULL,
       error = list(code = -32000L, message = response$error$message,
                    data = response$error))
}
cat(jsonlite::toJSON(wire_response, auto_unbox = TRUE, null = "null", na = "null",
                     dataframe = "rows", digits = NA), "\n")
quit(status = exit_status, save = "no")
