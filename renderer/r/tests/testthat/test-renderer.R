renderer_dir <- getOption("ggtree.air.renderer_dir")
fixture_dir <- file.path(renderer_dir, "fixtures")

testthat::test_that("isolated renderer validates and renders a semantic scene", {
  output <- tempfile("ggtree-air-renderer-")
  dir.create(output)
  tree <- load_tree(dist_path = file.path(fixture_dir, "easy_input.dist.tsv"))
  result <- run_analysis(tree, layout = "rectangular", intents = "treescale")
  files <- generate_all_plots(result, output_dir = output, format = "png",
                              width = 5, height = 4, dpi = 72)
  export_all(result, output_dir = output)
  scene_path <- extract_scene(result, output_dir = output)
  scene <- jsonlite::read_json(scene_path, simplifyVector = FALSE)
  testthat::expect_equal(scene$schema_version, "1.2.0")
  testthat::expect_equal(scene$views[[1]]$variant, "intents")
  testthat::expect_equal(scene$views[[1]]$artifact$path, "tree_rectangular_intents.png")
  testthat::expect_equal(length(scene$views[[1]]$nodes), 10L)
  coords <- vapply(scene$views[[1]]$nodes, function(node) node$artifact_coordinate$x,
                   numeric(1))
  testthat::expect_true(all(coords >= 0 & coords <= 1))
  testthat::expect_true(all(file.info(files)$size > 0))
})

testthat::test_that("metadata columns route into grouped and heatmap views", {
  tree <- load_tree(dist_path = file.path(fixture_dir, "easy_input.dist.tsv"))
  metadata <- tempfile(fileext = ".csv")
  utils::write.csv(data.frame(
    ID = paste0("strain", 1:6),
    Clade = rep(c("A", "B"), 3),
    Resistance = c("R", "S", "S", "R", "R", "S"),
    Type = rep(c("commensal", "pathogen"), 3),
    Size = c(10, 20, 30, 40, 50, 60),
    Score = seq(0.1, 0.6, by = 0.1)
  ), metadata, row.names = FALSE)
  result <- run_analysis(
    tree, layout = "rectangular", intents = c("tipcolor", "heatmap"),
    metadata_by = metadata, tip_column = "ID", group_column = "Clade",
    size_column = "Size", shape_column = "Type",
    heatmap_columns = c("Resistance", "Score")
  )
  testthat::expect_equal(result$group_levels, c("A", "B"))
  testthat::expect_setequal(result$intent_status$status, "applied")
  testthat::expect_equal(result$heatmap_columns, c("Resistance", "Score"))
})

testthat::test_that("tip-label repair is explicit and deterministic", {
  malformed <- tempfile(fileext = ".nwk")
  writeLines("(A:1,:1,B:1);", malformed)
  testthat::expect_error(load_tree(tree_path = malformed), "repair-tip-labels")
  repaired <- suppressWarnings(load_tree(tree_path = malformed, repair_tip_labels = TRUE))
  testthat::expect_true(any(grepl("^unlabeled_tip_", repaired$tip_labels)))
})

testthat::test_that("structured feedback becomes a deterministic overlay", {
  tree <- load_tree(dist_path = file.path(fixture_dir, "easy_input.dist.tsv"))
  result <- run_analysis(tree, layout = "rectangular", intents = "treescale")
  feedback <- list(annotations = list(list(
    id = "one", view_id = "view:rectangular", intent = "highlight",
    instruction = "highlight", selector = list(kind = "clade", node = result$node_ids[1])
  )))
  compiled <- apply_feedback_overlays(result, feedback)
  testthat::expect_equal(compiled$status$status, "applied")
  testthat::expect_gt(length(compiled$result$base_plots$rectangular$layers),
                      length(result$base_plots$rectangular$layers))
  testthat::expect_gt(length(compiled$result$intent_plots$rectangular$layers),
                      length(result$intent_plots$rectangular$layers))
})
