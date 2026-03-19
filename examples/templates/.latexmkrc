$latex = 'uplatex -synctex=1 -halt-on-error -interaction=nonstopmode -file-line-error %O %S';
$bibtex = 'pbibtex %O %S';
$biber = 'biber --bblencoding=utf8 -u -U --output_safechars %O %S';
$makeindex = 'mendex %O -o %D %S';
$dvipdf = 'dvipdfmx %O -o %D %S';
$max_repeat = 5;
$pdf_mode = 3;
$clean_ext = 'acn acr alg aux bbl blg fdb_latexmk fls glo gls idx ilg ind ist lof log lot out toc run.xml dvi';