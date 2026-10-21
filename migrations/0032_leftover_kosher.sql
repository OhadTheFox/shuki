-- stage 9, מ18 (q035): a leftover cooked from a recipe is meat or dairy, for the prompt in a kosher house ('meat' | 'dairy')
ALTER TABLE leftovers ADD COLUMN kosher_kind TEXT;
