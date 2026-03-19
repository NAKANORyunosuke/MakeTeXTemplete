$latex = 'platex -synctex=1 -interaction=nonstopmode -file-line-error %O %S';
$bibtex = 'pbibtex %O %B';
$makeindex = 'mendex %O -o %D %S';
$dvipdf = 'dvipdfmx %O -o %D %S';
$pdf_mode = 3;
$max_repeat = 5;
